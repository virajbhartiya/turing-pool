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

import { BASE_URL, CHAIN_ID, RPC_URL, SERVER_DOMAIN } from './config.js';
import {
  client,
  dailyCap,
  deployments,
  lookupHuman,
  quotaRemaining,
  recentSwaps,
  strategyHistory,
} from './chain.js';
import { amountForOverQuotaQuote, classifyRuntime, parseQuoteAmount } from './demo.js';
import { onChainFeePolicy } from './fee-policy.js';
import { hostedDemoQuotes, hostedState } from './hosted-snapshot.js';
import {
  demoTradesEnabled,
  executeDemoTrade,
  quoteRouterFor,
  routerOpcode,
  routerPoolState,
  type DemoTradeLane,
} from './router-demo.js';

const app = new Hono();
app.use('*', cors());
const SNAPSHOT_MODE = process.env.HOSTED_DEMO_MODE === 'snapshot';

const storage = new InMemoryAgentKitStorage();
const CHAIN = `eip155:${CHAIN_ID}`;
const STATEMENT =
  'Prove you are an agent backed by a unique human so a shared quota can bound LP risk and safely unlock tight-spread pricing.';

const SUBGRAPH_URL = process.env.SUBGRAPH_URL;
let graphStatusCache:
  | {
      checkedAt: number;
      value: {
        configured: boolean;
        endpoint: string | null;
        status: 'connected' | 'error' | 'not-configured';
        indexedBlock: string | null;
        hasIndexingErrors: boolean | null;
        error?: string;
      };
    }
  | undefined;

async function graphStatus() {
  if (!SUBGRAPH_URL) {
    return {
      configured: false,
      endpoint: null,
      status: 'not-configured' as const,
      indexedBlock: null,
      hasIndexingErrors: null,
    };
  }
  if (graphStatusCache && Date.now() - graphStatusCache.checkedAt < 10_000) {
    return graphStatusCache.value;
  }
  try {
    const response = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ _meta { block { number } hasIndexingErrors } }' }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as {
      data?: { _meta?: { block?: { number?: number }; hasIndexingErrors?: boolean } };
      errors?: Array<{ message?: string }>;
    };
    if (body.errors?.length) {
      throw new Error(body.errors.map((error) => error.message ?? 'GraphQL error').join('; '));
    }
    const value = {
      configured: true,
      endpoint: SUBGRAPH_URL,
      status: 'connected' as const,
      indexedBlock: body.data?._meta?.block?.number?.toString() ?? null,
      hasIndexingErrors: body.data?._meta?.hasIndexingErrors ?? null,
    };
    graphStatusCache = { checkedAt: Date.now(), value };
    return value;
  } catch (error) {
    const value = {
      configured: true,
      endpoint: SUBGRAPH_URL,
      status: 'error' as const,
      indexedBlock: null,
      hasIndexingErrors: null,
      error: error instanceof Error ? error.message : String(error),
    };
    graphStatusCache = { checkedAt: Date.now(), value };
    return value;
  }
}

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
  let amountIn: bigint;
  try {
    amountIn = parseQuoteAmount(c.req.query('amountIn'));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'invalid amountIn' }, 400);
  }
  const zeroForOne = (c.req.query('zeroForOne') ?? 'true') === 'true';
  const anonymous = c.req.query('anonymous') === '1';
  const resourceUri = `${BASE_URL}/quote`;
  const header = c.req.header('agentkit');

  if (SNAPSHOT_MODE) {
    if (!header && !anonymous) {
      return c.json(agentkitChallenge(resourceUri), 402);
    }
    const preview = hostedDemoQuotes(amountIn);
    const quote = header ? preview.human : preview.bot;
    return c.json({
      pool: 'tETH/tUSD',
      mode: preview.mode,
      amountIn: amountIn.toString(),
      zeroForOne,
      identity: {
        verified: false,
        simulated: true,
        note: 'Hosted preview snapshot; run the fork demo for cryptographic verification',
      },
      tier: quote.tier,
      feeBps: quote.feeBps,
      amountOut: quote.amountOut,
      wideAmountOut: preview.bot.amountOut,
      improvementBps: preview.improvementBps,
      quotaRemainingTokenIn: preview.sybil.sharedQuotaRemaining,
      execute: {
        available: false,
        note: 'Snapshot quotes are not executable; use pnpm demo:fork for live execution',
      },
    });
  }

  let taker: `0x${string}` = deployments.bot;
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

  const q = await quoteRouterFor(taker, amountIn, undefined, zeroForOne);
  const wide = await quoteRouterFor(deployments.bot, amountIn, undefined, zeroForOne);

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
      to: deployments.router,
      function: 'swap((address,uint256,bytes),address,address,uint256,bytes)',
      orderHash: q.strategyHash,
      note: 'taker approves tokenIn to the SwapVM router; _humanGate re-resolves identity, quota, and the current volume-priced fee on-chain',
    },
  });
});

/// Dashboard helper: live quotes for the three demo takers (on-chain eth_calls;
/// the tier shown is exactly what each taker would receive on-chain right now).
app.get('/demo/quotes', async (c) => {
  let amountIn: bigint;
  try {
    amountIn = parseQuoteAmount(c.req.query('amountIn'));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'invalid amountIn' }, 400);
  }
  if (SNAPSHOT_MODE) {
    return c.json(hostedDemoQuotes(amountIn));
  }
  const [human, bot] = await Promise.all([
    quoteRouterFor(deployments.humanAgent, amountIn),
    quoteRouterFor(deployments.bot, amountIn),
  ]);
  const sharedHumanId = human.humanId || BigInt(deployments.humanId);
  const remaining = await quotaRemaining(sharedHumanId, human.strategy.token0);
  const sybilAmountIn = amountForOverQuotaQuote(remaining);
  const sybil = await quoteRouterFor(deployments.sybilAgent, sybilAmountIn);
  const row = (
    label: string,
    q: Awaited<ReturnType<typeof quoteRouterFor>>,
    address: string,
    quotedAmountIn: bigint,
  ) => ({
    label,
    address,
    amountIn: quotedAmountIn.toString(),
    tier: q.tight ? 'tight' : 'wide',
    feeBps: q.feeBps.toString(),
    amountOut: q.amountOut.toString(),
    humanId: q.humanId === 0n ? null : q.humanId.toString(),
  });
  const improvementBps =
    bot.amountOut > 0n ? Number(((human.amountOut - bot.amountOut) * 10_000n) / bot.amountOut) : 0;
  return c.json({
    amountIn: amountIn.toString(),
    comparisonAmountIn: amountIn.toString(),
    human: row('Human-backed agent', human, deployments.humanAgent, amountIn),
    bot: row('Anonymous bot', bot, deployments.bot, amountIn),
    sybil: {
      ...row('Sybil twin (same human)', sybil, deployments.sybilAgent, sybilAmountIn),
      sharedQuotaRemaining: remaining.toString(),
      proof: 'quoted amount is exactly one wei above the quota wallet #1 left for this humanId',
    },
    improvementBps,
    rationale:
      'Sybil-resistant per-human quotas bound the LP’s maximum adverse-selection exposure; the tighter quote prices that lower risk.',
  });
});

app.post('/demo/trade', async (c) => {
  if (!demoTradesEnabled()) {
    return c.json({ error: 'interactive demo trades are disabled on this runtime' }, 503);
  }
  const allowedOrigin = process.env.DEMO_TRADE_ORIGIN;
  const requestOrigin = c.req.header('origin');
  if (allowedOrigin && requestOrigin !== allowedOrigin) {
    return c.json({ error: 'demo trades must be submitted from the configured dashboard' }, 403);
  }

  let body: { lane?: unknown; amountIn?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'request body must be JSON' }, 400);
  }
  if (body.lane !== 'human' && body.lane !== 'bot') {
    return c.json({ error: 'lane must be "human" or "bot"' }, 400);
  }
  let amountIn: bigint;
  try {
    amountIn = parseQuoteAmount(typeof body.amountIn === 'string' ? body.amountIn : undefined);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'invalid amountIn' }, 400);
  }

  try {
    return c.json(await executeDemoTrade(body.lane as DemoTradeLane, amountIn));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'trade execution failed';
    const busy = /already in progress|wait before submitting/.test(message);
    const unavailable = /not configured|disabled/.test(message);
    return c.json({ error: message }, busy ? 429 : unavailable ? 503 : 500);
  }
});

app.get('/state', async (c) => {
  if (SNAPSHOT_MODE) {
    return c.json(hostedState());
  }
  const [state, swaps, strategies, latestBlock, rpcChainId, graph, opcode] = await Promise.all([
    routerPoolState(),
    recentSwaps(),
    strategyHistory(),
    client.getBlockNumber({ cacheTime: 0 }),
    client.getChainId(),
    graphStatus(),
    routerOpcode(),
  ]);
  const humanId = BigInt(deployments.humanId);
  const [remEth, remUsd, cap0, cap1] = await Promise.all([
    quotaRemaining(humanId, state.strategy.token0),
    quotaRemaining(humanId, state.strategy.token1),
    dailyCap(state.strategy.token0),
    dailyCap(state.strategy.token1),
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
    execution: {
      enabled: demoTradesEnabled(),
      venue: 'SwapVM',
      opcode,
      instruction: '_humanGate',
      event: 'HumanGated',
      router: deployments.router,
      humanWallet: deployments.humanAgent,
      botWallet: deployments.bot,
      tightFeeBps: state.program.tightFeeBps,
      wideFeeBps: state.program.wideFeeBps,
      feeSource: 'HumanQuota.feeSchedule',
      repricesAfter: 'each mined SwapVM fill',
    },
    runtime: {
      ...classifyRuntime(rpcChainId, deployments.mockAgentBook, RPC_URL),
      chainId: rpcChainId,
      latestBlock: latestBlock.toString(),
      rpcStatus: 'connected',
    },
    dataSources: {
      quotes: {
        name: 'SwapVM router eth_call',
        status: 'connected',
        block: latestBlock.toString(),
      },
      strategy: {
        name: 'Aqua Shipped/Docked events',
        status: 'connected',
        historyEntries: strategies.length,
      },
      strategist: {
        name: graph.configured ? 'The Graph' : 'Chain-event fallback',
        ...graph,
      },
    },
    pool: {
      strategyHash: state.strategyHash,
      orderHash: state.orderHash,
      venue: 'SwapVM',
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
      dailyCapToken0: cap0.toString(),
      dailyCapToken1: cap1.toString(),
    },
    stats: {
      totalSwaps: swaps.length,
      tightSwaps: tightSwaps.length,
      wideSwaps: wideSwaps.length,
    },
    feeController: onChainFeePolicy(state.feeController, {
      observedSwaps: swaps.length,
      tightSwaps: tightSwaps.length,
      wideSwaps: wideSwaps.length,
    }),
    strategyHistory: strategies,
    swaps,
  });
});

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'turing-pool',
    mode: SNAPSHOT_MODE ? 'hosted-preview-snapshot' : 'live-chain',
  }),
);

app.get('/api', (c) =>
  c.json({
    name: 'Turing Pool quote API',
    hint: 'GET /quote?amountIn=1000000000000000000&zeroForOne=true (AgentKit header for tight tier, ?anonymous=1 for wide)',
  }),
);

export default app;
