import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { randomBytes } from 'node:crypto';
import {
  parseAgentkitHeader,
  validateAgentkitMessage,
  verifyAgentkitSignature,
  buildAgentkitSchema,
  InMemoryAgentKitStorage,
} from '@worldcoin/agentkit';

import { BASE_URL, CHAIN_ID, PORT, SERVER_DOMAIN } from './config.js';
import {
  deployments,
  lookupHuman,
  poolState,
  quotaRemaining,
  quoteFor,
  recentSwaps,
} from './chain.js';

const app = new Hono();
app.use('*', cors());

const storage = new InMemoryAgentKitStorage();
const CHAIN = `eip155:${CHAIN_ID}`;
const STATEMENT =
  'Prove you are an agent backed by a unique human to receive tight-spread pricing on Turing Pool.';

/// x402-style 402 response carrying the AgentKit extension. The
/// @worldcoin/agentkit client detects this shape and auto-signs a SIWE proof.
function agentkitChallenge(resourceUri: string) {
  return {
    x402Version: 2,
    error: 'agentkit_proof_required',
    accepts: [],
    extensions: {
      agentkit: {
        info: {
          domain: SERVER_DOMAIN,
          uri: resourceUri,
          statement: STATEMENT,
          version: '1',
          nonce: randomBytes(16).toString('hex'),
          issuedAt: new Date().toISOString(),
          expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
          resources: [resourceUri],
        },
        supportedChains: [{ chainId: CHAIN, type: 'eip191' as const }],
        schema: buildAgentkitSchema(),
        mode: 'free',
      },
    },
  };
}

interface VerifiedAgent {
  address: `0x${string}`;
  humanId: bigint;
}

/// Full AgentKit verification: parse header -> validate SIWE fields + nonce
/// freshness -> verify signature -> resolve humanId from the on-chain AgentBook.
async function verifyAgent(header: string, resourceUri: string): Promise<VerifiedAgent | { error: string }> {
  let payload;
  try {
    payload = parseAgentkitHeader(header);
  } catch (err) {
    return { error: `unparseable agentkit header: ${(err as Error).message}` };
  }

  const validation = await validateAgentkitMessage(payload, resourceUri, {
    maxAge: 5 * 60_000,
    checkNonce: async (nonce) => !(await storage.hasUsedNonce(nonce)),
  });
  if (!validation.valid) return { error: `validation failed: ${validation.error}` };

  const verification = await verifyAgentkitSignature(payload, process.env.RPC_URL ?? 'http://127.0.0.1:8545');
  if (!verification.valid || !verification.address) {
    return { error: `signature verification failed: ${verification.error}` };
  }
  await storage.recordNonce(payload.nonce);

  const humanId = await lookupHuman(verification.address as `0x${string}`);
  return { address: verification.address as `0x${string}`, humanId };
}

app.get('/quote', async (c) => {
  const amountIn = BigInt(c.req.query('amountIn') ?? '1000000000000000000');
  const zeroForOne = (c.req.query('zeroForOne') ?? 'true') === 'true';
  const anonymous = c.req.query('anonymous') === '1';
  const resourceUri = `${BASE_URL}/quote`;
  const header = c.req.header('agentkit');

  let taker: `0x${string}` = '0x0000000000000000000000000000000000000000';
  let identity: Record<string, unknown> = { verified: false, tier: 'wide' };

  if (header) {
    const result = await verifyAgent(header, resourceUri);
    if ('error' in result) {
      return c.json({ error: result.error }, 401);
    }
    taker = result.address;
    identity = {
      verified: true,
      address: result.address,
      humanBacked: result.humanId !== 0n,
      humanId: result.humanId.toString(),
    };
  } else if (!anonymous) {
    // Invite the caller to prove human backing - AgentKit clients handle this automatically.
    return c.json(agentkitChallenge(resourceUri), 402);
  }

  const q = await quoteFor(taker, amountIn, zeroForOne);
  const wide = await quoteFor('0x0000000000000000000000000000000000000000', amountIn, zeroForOne);

  const tokenIn = zeroForOne ? q.strategy.token0 : q.strategy.token1;
  const quotaLeft =
    q.humanId !== 0n ? await quotaRemaining(q.humanId, tokenIn) : 0n;

  const improvementBps =
    wide.amountOut > 0n ? Number(((q.amountOut - wide.amountOut) * 10_000n) / wide.amountOut) : 0;

  return c.json({
    pool: 'tETH/tUSD',
    amountIn: amountIn.toString(),
    zeroForOne,
    identity,
    tier: q.tight ? 'tight' : 'wide',
    feeBps: q.feeBps.toString(),
    amountOut: q.amountOut.toString(),
    wideAmountOut: wide.amountOut.toString(),
    improvementBps,
    quotaRemainingTokenIn: quotaLeft.toString(),
    execute: {
      to: deployments.app,
      function: 'swapExactIn((address,address,address,uint256,uint256,bytes32),bool,uint256,uint256,address)',
      strategy: {
        maker: q.strategy.maker,
        token0: q.strategy.token0,
        token1: q.strategy.token1,
        wideFeeBps: q.strategy.wideFeeBps.toString(),
        tightFeeBps: q.strategy.tightFeeBps.toString(),
        salt: q.strategy.salt,
      },
      note: 'taker must approve tokenIn to the app, then call swapExactIn; tier is re-resolved on-chain at swap time',
    },
  });
});

app.get('/state', async (c) => {
  const [state, swaps] = await Promise.all([poolState(), recentSwaps()]);
  const humanId = BigInt(deployments.humanId);
  const [remEth, remUsd] = await Promise.all([
    quotaRemaining(humanId, state.strategy.token0),
    quotaRemaining(humanId, state.strategy.token1),
  ]);
  const tightSwaps = swaps.filter((s) => s.tight);
  const wideSwaps = swaps.filter((s) => !s.tight);
  return c.json({
    contracts: {
      aqua: deployments.aqua,
      agentBook: deployments.agentBook,
      app: deployments.app,
      router: deployments.router,
      quota: deployments.quota,
      mockAgentBook: deployments.mockAgentBook,
    },
    pool: {
      strategyHash: state.strategyHash,
      token0: state.strategy.token0,
      token1: state.strategy.token1,
      balance0: state.balance0.toString(),
      balance1: state.balance1.toString(),
      wideFeeBps: state.strategy.wideFeeBps.toString(),
      tightFeeBps: state.strategy.tightFeeBps.toString(),
    },
    demoHuman: {
      humanId: deployments.humanId,
      quotaRemainingToken0: remEth.toString(),
      quotaRemainingToken1: remUsd.toString(),
    },
    stats: {
      totalSwaps: swaps.length,
      tightSwaps: tightSwaps.length,
      wideSwaps: wideSwaps.length,
    },
    swaps,
  });
});

app.get('/', (c) =>
  c.json({
    name: 'Turing Pool quote API',
    hint: 'GET /quote?amountIn=1000000000000000000&zeroForOne=true (AgentKit header for tight tier, ?anonymous=1 for wide)',
  }),
);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[turing-pool] quote API on http://localhost:${info.port}`);
  console.log(`[turing-pool] app=${deployments.app} agentBook=${deployments.agentBook}`);
});
