import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { streamText } from 'hono/streaming';
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
  configuredStrategyHistory,
  dailyCap,
  deployments,
  lookupHuman,
  quotaRemaining,
  recentSwaps,
} from './chain.js';
import {
  amountForOverQuotaQuote,
  classifyRuntime,
  describeTradeError,
  parseQuoteAmount,
} from './demo.js';
import { onChainFeePolicy } from './fee-policy.js';
import { hostedDemoQuotes, hostedState } from './hosted-snapshot.js';
import { loadNuthatchActivity, type NuthatchActivity } from './nuthatch.js';
import {
  demoTradesEnabled,
  confirmConnectedWalletTrade,
  directionFromZeroForOne,
  executeDemoTrade,
  parseDemoTradeDirection,
  prepareConnectedWalletTrade,
  quoteConnectedWallet,
  quoteRouterFor,
  routerOpcode,
  routerPoolState,
  type DemoTradeDirection,
  type DemoTradeLane,
} from './router-demo.js';
import {
  prepareCreateVault,
  prepareVaultLiquidity,
  prepareVaultTrade,
  quoteVaultWallet,
  vaultRegistry,
  vaultState,
} from './vaults.js';

const app = new Hono();
app.use('*', cors());
const SNAPSHOT_MODE = process.env.HOSTED_DEMO_MODE === 'snapshot';

const storage = new InMemoryAgentKitStorage();
const CHAIN = `eip155:${CHAIN_ID}`;
const STATEMENT =
  'Prove you are an agent backed by a unique human so a shared quota can bound LP risk and safely unlock tight-spread pricing.';

const SUBGRAPH_URL = process.env.SUBGRAPH_URL;
const NUTHATCH_URL = process.env.NUTHATCH_URL;

function errorDescription(error: unknown, depth = 0): string {
  if (depth >= 4) return '';
  if (error instanceof Error) {
    const cause = 'cause' in error ? error.cause : undefined;
    return `${error.name}: ${error.message} ${errorDescription(cause, depth + 1)}`;
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;
    return ['message', 'shortMessage', 'details', 'status', 'code', 'cause']
      .map((key) => candidate[key])
      .filter((value) => value !== undefined)
      .map((value) => errorDescription(value, depth + 1))
      .join(' ');
  }
  return error === undefined ? '' : String(error);
}

function describeLiveReadError(error: unknown) {
  const rateLimited = /(?:\b429\b|too many requests|rate[ -]?limit)/i.test(
    errorDescription(error),
  );
  return {
    code: rateLimited ? 'rpc_rate_limited' : 'live_data_unavailable',
    error: rateLimited
      ? 'The execution chain is temporarily busy. Wait a few seconds and try again.'
      : 'Live on-chain data is temporarily unavailable. Please try again.',
    retryable: true,
    retryAfterSeconds: 5,
    status: 503 as const,
  };
}

function liveReadErrorResponse(c: Context, error: unknown) {
  const safeError = describeLiveReadError(error);
  c.header('Retry-After', safeError.retryAfterSeconds.toString());
  return c.json(safeError, safeError.status);
}

function vaultOriginAllowed(c: Context): boolean {
  const allowedOrigin = process.env.DEMO_TRADE_ORIGIN;
  return !allowedOrigin || c.req.header('origin') === allowedOrigin;
}

function vaultRequestError(c: Context, error: unknown) {
  const description = errorDescription(error);
  if (
    /must be|not registered|not configured|no active Aqua order|insufficient|returned zero|different contracts/i.test(
      description,
    )
  ) {
    return c.json(
      {
        code: /insufficient/i.test(description)
          ? 'insufficient_balance'
          : 'invalid_trade_request',
        error: error instanceof Error ? error.message : 'invalid vault request',
        retryable: false,
        status: 400,
      },
      400,
    );
  }
  const safeError = describeTradeError(error);
  return c.json(safeError, safeError.status);
}

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

type ActivityIndex =
  | ({
      configured: true;
      name: 'Nuthatch';
      endpoint: string;
      status: 'connected';
      mode: 'sql+mcp';
    } & NuthatchActivity)
  | {
      configured: true;
      name: 'Nuthatch';
      endpoint: string;
      status: 'error';
      mode: 'sql+mcp';
      error: string;
    }
  | {
      configured: boolean;
      name: string;
      endpoint: string | null;
      status: 'connected' | 'error' | 'not-configured';
      mode: 'graphql' | 'chain-events';
      indexedBlock: string | null;
      error?: string;
    };

let activityIndexCache:
  | {
      checkedAt: number;
      value: ActivityIndex;
    }
  | undefined;

async function activityIndex(): Promise<ActivityIndex> {
  if (activityIndexCache && Date.now() - activityIndexCache.checkedAt < 1_500) {
    return activityIndexCache.value;
  }
  let value: ActivityIndex;
  if (NUTHATCH_URL) {
    try {
      value = {
        configured: true,
        name: 'Nuthatch',
        endpoint: NUTHATCH_URL,
        mode: 'sql+mcp',
        ...(await loadNuthatchActivity(NUTHATCH_URL)),
      };
    } catch (error) {
      value = {
        configured: true,
        name: 'Nuthatch',
        endpoint: NUTHATCH_URL,
        status: 'error',
        mode: 'sql+mcp',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    const graph = await graphStatus();
    value = graph.configured
      ? {
          ...graph,
          name: 'The Graph',
          mode: 'graphql',
        }
      : {
          configured: false,
          name: 'Direct chain events',
          endpoint: null,
          status: 'not-configured',
          mode: 'chain-events',
          indexedBlock: null,
        };
  }
  activityIndexCache = { checkedAt: Date.now(), value };
  return value;
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
  const direction = directionFromZeroForOne(zeroForOne);
  const anonymous = c.req.query('anonymous') === '1';
  const resourceUri = `${BASE_URL}/quote`;
  const header = c.req.header('agentkit');

  if (SNAPSHOT_MODE) {
    if (!header && !anonymous) {
      return c.json(agentkitChallenge(resourceUri), 402);
    }
    const preview = hostedDemoQuotes(amountIn, direction);
    const quote = header ? preview.human : preview.bot;
    return c.json({
      pool: 'tETH/tUSD',
      mode: preview.mode,
      amountIn: amountIn.toString(),
      direction: preview.direction,
      zeroForOne: preview.zeroForOne,
      tokenIn: preview.tokenIn,
      tokenOut: preview.tokenOut,
      tokenInSymbol: preview.tokenInSymbol,
      tokenOutSymbol: preview.tokenOutSymbol,
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
      feeSchedule: preview.feeSchedule,
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

  const q = await quoteRouterFor(taker, amountIn, undefined, direction);
  const wide = await quoteRouterFor(deployments.bot, amountIn, undefined, direction);

  const tokenIn = q.tokenIn;
  const quotaLeft =
    q.humanId !== 0n ? await quotaRemaining(q.humanId, tokenIn) : 0n;

  const improvementBps =
    wide.amountOut > 0n ? Number(((q.amountOut - wide.amountOut) * 10_000n) / wide.amountOut) : 0;

  return c.json({
    pool: 'tETH/tUSD',
    amountIn: amountIn.toString(),
    direction: q.direction,
    zeroForOne: q.zeroForOne,
    tokenIn: q.tokenIn,
    tokenOut: q.tokenOut,
    tokenInSymbol: q.tokenInSymbol,
    tokenOutSymbol: q.tokenOutSymbol,
    identity,
    tier: q.tight ? 'tight' : 'wide',
    feeBps: q.feeBps.toString(),
    amountOut: q.amountOut.toString(),
    wideAmountOut: wide.amountOut.toString(),
    improvementBps,
    quotaRemainingTokenIn: quotaLeft.toString(),
    feeSchedule: {
      tightFeeBps: q.feeSchedule.tightFeeBps.toString(),
      wideFeeBps: q.feeSchedule.wideFeeBps.toString(),
      targetFeeBps: q.feeSchedule.targetFeeBps.toString(),
      humanShareBps: q.feeSchedule.humanShareBps.toString(),
      tightVolume: q.feeSchedule.tightVolume.toString(),
      wideVolume: q.feeSchedule.wideVolume.toString(),
    },
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
  let direction: DemoTradeDirection;
  try {
    amountIn = parseQuoteAmount(c.req.query('amountIn'));
    direction = parseDemoTradeDirection(c.req.query('direction'));
  } catch (error) {
    return c.json(
      {
        code: 'invalid_trade_request',
        error: error instanceof Error ? error.message : 'invalid demo quote request',
        retryable: false,
        status: 400,
      },
      400,
    );
  }
  if (SNAPSHOT_MODE) {
    return c.json(hostedDemoQuotes(amountIn, direction));
  }
  try {
    const [human, bot] = await Promise.all([
      quoteRouterFor(deployments.humanAgent, amountIn, undefined, direction),
      quoteRouterFor(deployments.bot, amountIn, undefined, direction),
    ]);
  const sharedHumanId = human.humanId || BigInt(deployments.humanId);
  const remaining = await quotaRemaining(sharedHumanId, human.tokenIn);
  const sybilAmountIn = amountForOverQuotaQuote(remaining);
  const sybil = await quoteRouterFor(deployments.sybilAgent, sybilAmountIn, undefined, direction);
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
    direction: q.direction,
    zeroForOne: q.zeroForOne,
    tokenIn: q.tokenIn,
    tokenOut: q.tokenOut,
    tokenInSymbol: q.tokenInSymbol,
    tokenOutSymbol: q.tokenOutSymbol,
  });
  const improvementBps =
    bot.amountOut > 0n ? Number(((human.amountOut - bot.amountOut) * 10_000n) / bot.amountOut) : 0;
    return c.json({
    amountIn: amountIn.toString(),
    comparisonAmountIn: amountIn.toString(),
    direction: human.direction,
    zeroForOne: human.zeroForOne,
    tokenIn: human.tokenIn,
    tokenOut: human.tokenOut,
    tokenInSymbol: human.tokenInSymbol,
    tokenOutSymbol: human.tokenOutSymbol,
    feeSchedule: {
      tightFeeBps: human.feeSchedule.tightFeeBps.toString(),
      wideFeeBps: human.feeSchedule.wideFeeBps.toString(),
      targetFeeBps: human.feeSchedule.targetFeeBps.toString(),
      humanShareBps: human.feeSchedule.humanShareBps.toString(),
      tightVolume: human.feeSchedule.tightVolume.toString(),
      wideVolume: human.feeSchedule.wideVolume.toString(),
    },
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
  } catch (error) {
    return liveReadErrorResponse(c, error);
  }
});

app.get('/wallet/quote', async (c) => {
  if (SNAPSHOT_MODE) {
    return c.json(
      {
        code: 'execution_unavailable',
        error: 'Connected-wallet execution requires a live chain runtime.',
        retryable: false,
        status: 503,
      },
      503,
    );
  }
  try {
    const amountIn = parseQuoteAmount(c.req.query('amountIn'));
    const direction = parseDemoTradeDirection(c.req.query('direction'));
    return c.json(
      await quoteConnectedWallet(c.req.query('address'), amountIn, direction),
    );
  } catch (error) {
    if (/wallet must|amountIn|direction must/i.test(errorDescription(error))) {
      return c.json(
        {
          code: 'invalid_trade_request',
          error: error instanceof Error ? error.message : 'invalid wallet quote request',
          retryable: false,
          status: 400,
        },
        400,
      );
    }
    return liveReadErrorResponse(c, error);
  }
});

app.post('/wallet/prepare', async (c) => {
  const allowedOrigin = process.env.DEMO_TRADE_ORIGIN;
  const requestOrigin = c.req.header('origin');
  if (allowedOrigin && requestOrigin !== allowedOrigin) {
    return c.json(
      {
        code: 'trade_forbidden',
        error: 'wallet trades must be submitted from the configured dashboard',
        retryable: false,
        status: 403,
      },
      403,
    );
  }
  let body: { address?: unknown; amountIn?: unknown; direction?: unknown };
  try {
    body = await c.req.json();
    const amountIn = parseQuoteAmount(
      typeof body.amountIn === 'string' ? body.amountIn : undefined,
    );
    const direction = parseDemoTradeDirection(body.direction);
    return c.json(
      await prepareConnectedWalletTrade(body.address, amountIn, direction),
    );
  } catch (error) {
    const description = errorDescription(error);
    if (/wallet must|amountIn|direction must|insufficient .* balance/i.test(description)) {
      return c.json(
        {
          code: /insufficient .* balance/i.test(description)
            ? 'insufficient_balance'
            : 'invalid_trade_request',
          error:
            error instanceof Error
              ? error.message
              : 'invalid connected-wallet trade request',
          retryable: false,
          status: 400,
        },
        400,
      );
    }
    const safeError = describeTradeError(error);
    return c.json(safeError, safeError.status);
  }
});

app.post('/wallet/confirm', async (c) => {
  const allowedOrigin = process.env.DEMO_TRADE_ORIGIN;
  const requestOrigin = c.req.header('origin');
  if (allowedOrigin && requestOrigin !== allowedOrigin) {
    return c.json(
      {
        code: 'trade_forbidden',
        error: 'wallet trades must be confirmed from the configured dashboard',
        retryable: false,
        status: 403,
      },
      403,
    );
  }
  let body: {
    address?: unknown;
    transactionHash?: unknown;
    approvalTransactionHash?: unknown;
    direction?: unknown;
  };
  try {
    body = await c.req.json();
    const direction = parseDemoTradeDirection(body.direction);
    return c.json(
      await confirmConnectedWalletTrade(
        body.address,
        body.transactionHash,
        direction,
        body.approvalTransactionHash,
      ),
    );
  } catch (error) {
    if (/wallet must|transactionHash|direction must/i.test(errorDescription(error))) {
      return c.json(
        {
          code: 'invalid_trade_request',
          error: error instanceof Error ? error.message : 'invalid wallet confirmation request',
          retryable: false,
          status: 400,
        },
        400,
      );
    }
    const safeError = describeTradeError(error);
    return c.json(safeError, safeError.status);
  }
});

app.post('/demo/trade', async (c) => {
  if (!demoTradesEnabled()) {
    const safeError = describeTradeError(
      new Error('interactive demo trades are disabled on this runtime'),
    );
    return c.json(safeError, safeError.status);
  }
  const allowedOrigin = process.env.DEMO_TRADE_ORIGIN;
  const requestOrigin = c.req.header('origin');
  if (allowedOrigin && requestOrigin !== allowedOrigin) {
    return c.json(
      {
        code: 'trade_forbidden',
        error: 'demo trades must be submitted from the configured dashboard',
        retryable: false,
        status: 403,
      },
      403,
    );
  }

  let body: { lane?: unknown; amountIn?: unknown; direction?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        code: 'invalid_trade_request',
        error: 'request body must be JSON',
        retryable: false,
        status: 400,
      },
      400,
    );
  }
  if (body.lane !== 'human' && body.lane !== 'bot') {
    return c.json(
      {
        code: 'invalid_trade_request',
        error: 'lane must be "human" or "bot"',
        retryable: false,
        status: 400,
      },
      400,
    );
  }
  let amountIn: bigint;
  let direction: DemoTradeDirection;
  try {
    amountIn = parseQuoteAmount(typeof body.amountIn === 'string' ? body.amountIn : undefined);
    direction = parseDemoTradeDirection(body.direction);
  } catch (error) {
    return c.json(
      {
        code: 'invalid_trade_request',
        error: error instanceof Error ? error.message : 'invalid trade request',
        retryable: false,
        status: 400,
      },
      400,
    );
  }

  if (c.req.header('accept')?.includes('application/x-ndjson')) {
    c.header('content-type', 'application/x-ndjson; charset=UTF-8');
    c.header('cache-control', 'no-cache, no-transform');
    return streamText(c, async (stream) => {
      const send = async (event: unknown) => {
        await stream.write(`${JSON.stringify(event)}\n`);
      };
      try {
        const result = await executeDemoTrade(
          body.lane as DemoTradeLane,
          amountIn,
          direction,
          async (progress) => send({ type: 'progress', progress }),
        );
        await send({ type: 'result', result });
      } catch (error) {
        console.error('[turing-pool] streamed demo trade failed', error);
        await send({ type: 'error', error: describeTradeError(error) });
      }
    });
  }

  try {
    return c.json(await executeDemoTrade(body.lane as DemoTradeLane, amountIn, direction));
  } catch (error) {
    console.error('[turing-pool] demo trade failed', error);
    const safeError = describeTradeError(error);
    if (safeError.retryAfterSeconds !== undefined) {
      c.header('Retry-After', safeError.retryAfterSeconds.toString());
    }
    return c.json(safeError, safeError.status);
  }
});

app.get('/state', async (c) => {
  if (SNAPSHOT_MODE) {
    return c.json(hostedState());
  }
  try {
    const [state, latestBlock, rpcChainId, index, opcode] = await Promise.all([
      routerPoolState(),
      client.getBlockNumber({ cacheTime: 0 }),
      client.getChainId(),
      activityIndex(),
      routerOpcode(),
    ]);
  const strategies = configuredStrategyHistory(state.strategy, state.strategyHash);
  let swaps: Awaited<ReturnType<typeof recentSwaps>>;
  if (index.mode === 'sql+mcp' && index.status === 'connected') {
    swaps = index.swaps;
  } else {
    try {
      swaps = await recentSwaps();
    } catch (error) {
      console.error('[turing-pool] activity scan unavailable', error);
      swaps = [];
    }
  }
  const indexMetadata =
    index.mode === 'sql+mcp' && index.status === 'connected'
      ? {
          configured: index.configured,
          name: index.name,
          endpoint: index.endpoint,
          status: index.status,
          mode: index.mode,
          indexedBlock: index.indexedBlock,
          sealedThrough: index.sealedThrough,
          lagBlocks: index.lagBlocks,
          registryHash: index.registryHash,
          provenance: index.provenance,
          summary: index.summary,
        }
      : index;
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
      vaultFactory: process.env.VAULT_FACTORY ?? deployments.vaultFactory,
      vaultRouter: deployments.vaultRouter,
      demoVault: deployments.demoVault,
      demoVaultQuota: deployments.demoVaultQuota,
      identityMirror: deployments.identityMirror,
      identityMode: deployments.identityMode,
      identitySourceAgentBook: deployments.identitySourceAgentBook,
      identitySourceBlock: deployments.identitySourceBlock?.toString(),
      identitySourceChainId: deployments.identitySourceChainId === undefined
        ? undefined
        : Number(deployments.identitySourceChainId),
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
      activity: {
        ...indexMetadata,
        name:
          index.name === 'Nuthatch'
            ? 'Nuthatch · SQL + MCP'
            : index.name,
        fallback:
          index.status === 'connected'
            ? null
            : 'Direct execution-chain event reads',
      },
      strategist: {
        ...indexMetadata,
        name:
          index.name === 'Nuthatch'
            ? 'Nuthatch semantic activity layer'
            : index.name,
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
  } catch (error) {
    return liveReadErrorResponse(c, error);
  }
});

app.get('/vaults', async (c) => {
  try {
    return c.json(await vaultRegistry(c.req.query('address')));
  } catch (error) {
    return liveReadErrorResponse(c, error);
  }
});

app.get('/vaults/:vault', async (c) => {
  try {
    return c.json(
      await vaultState(c.req.param('vault'), c.req.query('address')),
    );
  } catch (error) {
    return vaultRequestError(c, error);
  }
});

app.get('/vaults/:vault/quote', async (c) => {
  try {
    return c.json(
      await quoteVaultWallet(
        c.req.param('vault'),
        c.req.query('address'),
        c.req.query('amountIn'),
        c.req.query('direction'),
      ),
    );
  } catch (error) {
    return vaultRequestError(c, error);
  }
});

app.post('/vaults/create/prepare', async (c) => {
  if (!vaultOriginAllowed(c)) {
    return c.json(
      {
        code: 'trade_forbidden',
        error: 'vault creation must be submitted from the configured dashboard',
        retryable: false,
        status: 403,
      },
      403,
    );
  }
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    return c.json(await prepareCreateVault(body.address, body));
  } catch (error) {
    return vaultRequestError(c, error);
  }
});

app.post('/vaults/:vault/trade/prepare', async (c) => {
  if (!vaultOriginAllowed(c)) {
    return c.json(
      {
        code: 'trade_forbidden',
        error: 'vault trades must be submitted from the configured dashboard',
        retryable: false,
        status: 403,
      },
      403,
    );
  }
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    return c.json(
      await prepareVaultTrade(
        c.req.param('vault'),
        body.address,
        body.amountIn,
        body.direction,
      ),
    );
  } catch (error) {
    return vaultRequestError(c, error);
  }
});

app.post('/vaults/:vault/liquidity/prepare', async (c) => {
  if (!vaultOriginAllowed(c)) {
    return c.json(
      {
        code: 'trade_forbidden',
        error: 'liquidity actions must be submitted from the configured dashboard',
        retryable: false,
        status: 403,
      },
      403,
    );
  }
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    return c.json(
      await prepareVaultLiquidity(
        c.req.param('vault'),
        body.address,
        body.action,
        body,
      ),
    );
  } catch (error) {
    return vaultRequestError(c, error);
  }
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
