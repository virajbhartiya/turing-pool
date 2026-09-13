import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { streamText } from 'hono/streaming';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { Hash } from 'viem';
import {
  parseAgentkitHeader,
  validateAgentkitMessage,
  verifyAgentkitSignature,
  buildAgentkitSchema,
  createAgentBookVerifier,
  InMemoryAgentKitStorage,
} from '@worldcoin/agentkit';

import {
  AGENTKIT_SIGNER_NETWORK,
  AGENTKIT_SIGNER_RPC_URL,
  BASE_URL,
  CHAIN_ID,
  RPC_URL,
  SERVER_DOMAIN,
  WORLD_RPC_URL,
} from './config.js';
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
import { faucetState, prepareFaucetClaim } from './faucet.js';
import { hostedDemoQuotes, hostedState } from './hosted-snapshot.js';
import { loadNuthatchActivity, type NuthatchActivity } from './nuthatch.js';
import {
  marketTradesEnabled,
  directionFromZeroForOne,
  executeMarketTrade,
  parseDemoTradeDirection,
  quoteRouterFor,
  type DemoTradeDirection,
  type DemoTradeLane,
} from './router-demo.js';
import {
  confirmWebsiteWalletTrade,
  prepareWebsiteWalletTrade,
  quoteWebsiteComparisonWallet,
  quoteWebsiteWallet,
  websitePoolState,
} from './trade-venue.js';
import {
  prepareCreateVault,
  prepareVaultLiquidity,
  prepareVaultTrade,
  quoteVaultWallet,
  vaultRegistry,
  vaultState,
} from './vaults.js';
import {
  parseIdentityAddress,
  relayAgentBookRegistration,
  worldIdentityStatus,
  type AgentBookRegistration,
} from './world-identity.js';
import {
  buildAutopilotPlan,
  type AutopilotEvidence,
  type AutopilotIntent,
} from './autopilot.js';
import { AutopilotService, AutopilotStore, AutopilotValidationError } from './autopilot-service.js';
import { parseSlippageBps } from './slippage.js';

const app = new Hono();
app.use('*', cors());
const SNAPSHOT_MODE = process.env.HOSTED_DEMO_MODE === 'snapshot';

const storage = new InMemoryAgentKitStorage();
const canonicalAgentBook = createAgentBookVerifier({
  rpcUrl: WORLD_RPC_URL,
  contractAddress: deployments.agentBook,
});
const STATEMENT =
  'Prove this trading wallet belongs to a unique World ID-verified trader so a shared quota can bound LP risk and unlock tighter pricing.';

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
  console.error(
    '[turing-pool] live read failed',
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
  const safeError = describeLiveReadError(error);
  c.header('Retry-After', safeError.retryAfterSeconds.toString());
  return c.json(safeError, safeError.status);
}

function vaultOriginAllowed(c: Context): boolean {
  const allowedOrigin = process.env.MARKET_TRADE_ORIGIN;
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

function faucetRequestError(c: Context, error: unknown) {
  const description = errorDescription(error);
  if (/wallet address|claim again|temporarily empty|not configured|CooldownActive|InsufficientInventory/i.test(description)) {
    return c.json(
      {
        code: /empty|InsufficientInventory/i.test(description)
          ? 'faucet_empty'
          : /claim again|CooldownActive/i.test(description)
            ? 'faucet_cooldown'
            : 'invalid_faucet_request',
        error: error instanceof Error ? error.message : 'invalid faucet request',
        retryable: false,
        status: 400,
      },
      400,
    );
  }
  return liveReadErrorResponse(c, error);
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
      configured: false;
      name: 'Direct chain events';
      endpoint: null;
      status: 'connected';
      mode: 'chain-events';
      indexedBlock: string | null;
      sealedThrough: null;
      lagBlocks: number;
      registryHash: null;
      provenance: string;
      swaps: Awaited<ReturnType<typeof recentSwaps>>;
      feeHistory: [];
      summary: NuthatchActivity['summary'];
      riskWindow: NuthatchActivity['riskWindow'];
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
    if (graph.configured) {
      throw new Error(
        'A Subgraph endpoint is configured, but Autopilot requires Nuthatch SQL risk evidence.',
      );
    }
    const swaps = await recentSwaps();
    const tight = swaps.filter((swap) => swap.tight);
    const wide = swaps.filter((swap) => !swap.tight);
    const volume = (rows: typeof swaps) => rows.reduce((sum, row) => sum + BigInt(row.amountIn), 0n);
    const tightVolume = volume(tight);
    const wideVolume = volume(wide);
    const totalVolume = tightVolume + wideVolume;
    const tightShareBps = totalVolume > 0n ? Number(tightVolume * 10_000n / totalVolume) : 0;
    const average = (rows: typeof swaps, key: 'feeBps' | 'amountOut') => rows.length
      ? rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length
      : 0;
    const averagePrice = (rows: typeof swaps) => rows.length
      ? rows.reduce((sum, row) => {
          const amountIn = Number(BigInt(row.amountIn) / 10n ** 12n) / 1_000_000;
          const amountOut = Number(BigInt(row.amountOut) / 10n ** 12n) / 1_000_000;
          return sum + (amountIn > 0 ? amountOut / amountIn : 0);
        }, 0) / rows.length
      : 0;
    const indexedBlock = swaps[swaps.length - 1]?.blockNumber ?? null;
    value = {
      configured: false,
      name: 'Direct chain events',
      endpoint: null,
      status: 'connected',
      mode: 'chain-events',
      indexedBlock,
      sealedThrough: null,
      lagBlocks: 0,
      registryHash: null,
      provenance: 'Local execution fallback · direct event scan',
      swaps,
      feeHistory: [],
      summary: {
        fills: swaps.length,
        tightFills: tight.length,
        wideFills: wide.length,
        tightVolume: tightVolume.toString(),
        wideVolume: wideVolume.toString(),
        humanShareBps: tightShareBps,
        indexedTradeBlock: indexedBlock,
      },
      riskWindow: indexedBlock
        ? {
            fills: swaps.length,
            tightFills: tight.length,
            wideFills: wide.length,
            tightVolumeToken0: tightVolume.toString(),
            wideVolumeToken0: wideVolume.toString(),
            tightShareBps,
            avgTightFeeBps: average(tight, 'feeBps'),
            avgWideFeeBps: average(wide, 'feeBps'),
            avgTightPrice: String(averagePrice(tight)),
            avgWidePrice: String(averagePrice(wide)),
            indexedTradeBlock: indexedBlock,
            windowStartBlock: swaps[0]?.blockNumber ?? indexedBlock,
          }
        : null,
    };
  }
  activityIndexCache = { checkedAt: Date.now(), value };
  return value;
}

const autopilotPlans = new AutopilotStore(process.env.AUTOPILOT_STORE_PATH ??
  resolve(process.cwd(), '.data', `autopilot-${SNAPSHOT_MODE ? 'snapshot' : CHAIN_ID}.json`));
const autopilotService = new AutopilotService(autopilotPlans, {
  evidence: liveAutopilotEvidence,
  verifyOwner: async (owner) => !SNAPSHOT_MODE && await lookupHuman(parseIdentityAddress(owner)) !== 0n,
  blockNumber: () => client.getBlockNumber(),
  prepare: prepareWebsiteWalletTrade,
  confirm: confirmWebsiteWalletTrade,
  transaction: async (hash) => {
    const transaction = await client.getTransaction({ hash: hash as Hash });
    if (transaction.blockNumber === null) throw new Error('Strategy transaction has not been mined.');
    const block = await client.getBlock({ blockNumber: transaction.blockNumber });
    return { from: transaction.from, to: transaction.to, input: transaction.input, timestamp: block.timestamp };
  },
});

function snapshotAutopilotEvidence(): AutopilotEvidence {
  const state = hostedState();
  const tightShareBps = state.feeController.humanShareBps;
  return {
    source: 'snapshot',
    indexedBlock: null,
    observedAt: new Date().toISOString(),
    fills: state.stats.totalSwaps,
    tightShareBps,
    botShareBps: 10_000 - tightShareBps,
    currentTightFeeBps: state.feeController.tightFeeBps,
    currentWideFeeBps: state.feeController.wideFeeBps,
    averageExecutionPrice: 0,
    priceGapBps: 0,
    lagBlocks: 0,
    available: true,
    provenance: 'Hosted deterministic continuity preview',
  };
}

async function liveAutopilotEvidence(): Promise<AutopilotEvidence> {
  if (SNAPSHOT_MODE) return snapshotAutopilotEvidence();
  const [index, pool] = await Promise.all([activityIndex(), websitePoolState()]);
  if (index.status !== 'connected' || !index.riskWindow || (CHAIN_ID === 480 && index.mode !== 'sql+mcp')) {
    return {
      source: 'nuthatch',
      indexedBlock: null,
      observedAt: new Date().toISOString(),
      fills: 0,
      tightShareBps: 0,
      botShareBps: 10_000,
      currentTightFeeBps: pool.program.tightFeeBps,
      currentWideFeeBps: pool.program.wideFeeBps,
      averageExecutionPrice: 0,
      priceGapBps: 0,
      lagBlocks: Number.MAX_SAFE_INTEGER,
      available: false,
      provenance: index.status === 'error'
        ? index.error ?? 'Nuthatch request failed'
        : 'Nuthatch risk window unavailable',
    };
  }
  const risk = index.riskWindow;
  const tightPrice = Number(risk.avgTightPrice);
  const widePrice = Number(risk.avgWidePrice);
  const averageExecutionPrice = (tightPrice + widePrice) / 2;
  const priceGapBps = averageExecutionPrice > 0
    ? Math.abs(tightPrice - widePrice) / averageExecutionPrice * 10_000
    : 0;
  return {
    source: index.mode === 'sql+mcp' ? 'nuthatch' : 'chain-events',
    indexedBlock: risk.indexedTradeBlock,
    observedAt: new Date().toISOString(),
    fills: risk.fills,
    tightShareBps: risk.tightShareBps,
    botShareBps: 10_000 - risk.tightShareBps,
    currentTightFeeBps: pool.program.tightFeeBps,
    currentWideFeeBps: pool.program.wideFeeBps,
    averageExecutionPrice,
    priceGapBps,
    lagBlocks: index.lagBlocks,
    available: true,
    provenance: `${index.provenance} · registry ${index.registryHash ?? 'unavailable'}`,
  };
}

function autopilotNotFound(c: Context) {
  return c.json(
    { code: 'autopilot_not_found', error: 'Autopilot strategy was not found.', status: 404 },
    404,
  );
}

app.get('/autopilot/templates', (c) => c.json({
  templates: [
    {
      id: 'conditional-dca',
      name: 'Verified DCA',
      prompt: 'Convert 500 tUSD to tETH in 5 slices when bot activity is below 65% and fee is under 35 bps.',
    },
    {
      id: 'buy-the-dip',
      name: 'Price discipline',
      prompt: 'Convert 750 tUSD to tETH in 5 slices when execution dispersion is below 150 bps and fee is under 35 bps.',
    },
    {
      id: 'liquidity-shield',
      name: 'Liquidity shield',
      prompt: 'Convert 1 tETH to tUSD in 4 slices only when bot activity is below 45% and execution dispersion is below 100 bps.',
    },
  ],
}));

app.post('/autopilot/plan', async (c) => {
  let intent: AutopilotIntent;
  try {
    intent = await c.req.json<AutopilotIntent>();
  } catch {
    return c.json({ code: 'invalid_autopilot_intent', error: 'Request body must be JSON.', status: 400 }, 400);
  }
  if (typeof intent.prompt !== 'string' || intent.prompt.trim().length < 8) {
    return c.json({ code: 'invalid_autopilot_intent', error: 'Describe a trading goal in at least eight characters.', status: 400 }, 400);
  }
  try {
    // Connection establishes strategy ownership. World ID is an optional lane
    // upgrade evaluated at execution time; it must not be required to create
    // or activate a wallet-owned strategy.
    const connectedOwner = intent.owner === undefined ? undefined : parseIdentityAddress(intent.owner);
    const plan = buildAutopilotPlan(
      { ...intent, owner: connectedOwner },
      await liveAutopilotEvidence(),
    );
    autopilotPlans.set({ plan });
    return c.json(plan, 201);
  } catch (error) {
    return liveReadErrorResponse(c, error);
  }
});

app.get('/autopilot/:id', (c) => {
  const plan = autopilotPlans.get(c.req.param('id'))?.plan;
  return plan ? c.json(plan) : autopilotNotFound(c);
});

app.post('/autopilot/:id/evaluate', async (c) => {
  if (!autopilotPlans.get(c.req.param('id'))) return autopilotNotFound(c);
  try {
    return c.json(await autopilotService.evaluate(c.req.param('id')));
  } catch (error) {
    return liveReadErrorResponse(c, error);
  }
});

app.post('/autopilot/:id/activate', async (c) => {
  if (!autopilotPlans.get(c.req.param('id'))) return autopilotNotFound(c);
  try {
    return c.json(await autopilotService.evaluate(c.req.param('id'), 'active'));
  } catch (error) { return liveReadErrorResponse(c, error); }
});

app.post('/autopilot/:id/pause', async (c) => {
  if (!autopilotPlans.get(c.req.param('id'))) return autopilotNotFound(c);
  try {
    return c.json(await autopilotService.evaluate(c.req.param('id'), 'paused'));
  } catch (error) { return liveReadErrorResponse(c, error); }
});

app.post('/autopilot/:id/prepare', async (c) => {
  if (!autopilotPlans.get(c.req.param('id'))) return autopilotNotFound(c);
  try {
    const body = await c.req.json<{ address?: unknown }>();
    const address = parseIdentityAddress(body.address);
    return c.json(await autopilotService.prepare(c.req.param('id'), address));
  } catch (error) {
    if (!(error instanceof AutopilotValidationError)) return liveReadErrorResponse(c, error);
    return c.json({ code: 'autopilot_preparation_rejected', error: error.message, status: 400 }, 400);
  }
});

app.post('/autopilot/:id/confirm', async (c) => {
  const plan = autopilotPlans.get(c.req.param('id'));
  if (!plan) return autopilotNotFound(c);
  let body: { transactionHash?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 'invalid_autopilot_confirmation', error: 'Request body must be JSON.', status: 400 }, 400);
  }
  if (typeof body.transactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.transactionHash)) {
    return c.json({ code: 'invalid_autopilot_confirmation', error: 'A confirmed transaction hash is required.', status: 400 }, 400);
  }
  try {
    return c.json(await autopilotService.confirm(c.req.param('id'), body.transactionHash));
  } catch (error) {
    if (!(error instanceof AutopilotValidationError)) return liveReadErrorResponse(c, error);
    return c.json({ code: 'autopilot_confirmation_rejected', error: error.message, status: 400 }, 400);
  }
});

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
        supportedChains: [{ chainId: AGENTKIT_SIGNER_NETWORK, type: 'eip191' as const }],
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
  if (payload.chainId !== AGENTKIT_SIGNER_NETWORK) {
    return {
      error: `unsupported signer network: expected ${AGENTKIT_SIGNER_NETWORK}, got ${payload.chainId}`,
    };
  }

  const validation = await validateAgentkitMessage(payload, resourceUri, {
    maxAge: 5 * 60_000,
    checkNonce: async (nonce) => !(await storage.hasUsedNonce(nonce)),
  });
  if (!validation.valid) return { error: `validation failed: ${validation.error}` };

  const verification = await verifyAgentkitSignature(payload, AGENTKIT_SIGNER_RPC_URL);
  if (!verification.valid || !verification.address) {
    return { error: `signature verification failed: ${verification.error}` };
  }

  const canonicalHumanId = await canonicalAgentBook.lookupHuman(verification.address);
  await storage.recordNonce(payload.nonce);
  return {
    address: verification.address as `0x${string}`,
    humanId: canonicalHumanId === null ? 0n : BigInt(canonicalHumanId),
  };
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
        note: 'Hosted preview snapshot; use the live World Chain market for cryptographic verification',
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
        note: 'Snapshot quotes are not executable; use the live World Chain market',
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
    // Invite the caller to prove World ID verification. AgentKit clients handle this automatically.
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
      order: {
        maker: deployments.maker,
        traits: deployments.orderTraits,
        data: deployments.orderData,
      },
      note: 'taker approves tokenIn to the SwapVM router; _humanGate re-resolves identity, quota, and the current volume-priced fee on-chain',
    },
  });
});

/// Live market comparison: the tier shown is exactly what each reference taker
/// would receive from the on-chain router right now.
const marketQuotes = async (c: Context) => {
  let amountIn: bigint;
  let direction: DemoTradeDirection;
  try {
    amountIn = parseQuoteAmount(c.req.query('amountIn'));
    direction = parseDemoTradeDirection(c.req.query('direction'));
  } catch (error) {
    return c.json(
      {
        code: 'invalid_trade_request',
        error: error instanceof Error ? error.message : 'invalid market quote request',
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
      quoteWebsiteComparisonWallet(deployments.humanAgent, amountIn, direction),
      quoteWebsiteComparisonWallet(deployments.bot, amountIn, direction),
    ]);
    const sharedHumanId = BigInt(human.humanId);
    if (sharedHumanId === 0n) {
      throw new Error(
        'configured World ID-verified quote wallet is not registered in AgentBook',
      );
    }
    const remaining = await quotaRemaining(
      sharedHumanId,
      human.tokenIn,
      human.quota,
    );
    const sybilAmountIn = amountForOverQuotaQuote(remaining, amountIn);
    const sybil = await quoteWebsiteComparisonWallet(
      deployments.sybilAgent,
      sybilAmountIn,
      direction,
    );
    const row = (
      label: string,
      q: Awaited<ReturnType<typeof quoteWebsiteComparisonWallet>>,
      address: string,
      quotedAmountIn: bigint,
    ) => ({
      label,
      address,
      amountIn: quotedAmountIn.toString(),
      tier: q.tight ? 'tight' : 'wide',
      feeBps: q.feeBps.toString(),
      amountOut: q.amountOut,
      humanId: q.humanId === '0' ? null : q.humanId,
      direction: q.direction,
      zeroForOne: q.direction === 'tETH-to-tUSD',
      tokenIn: q.tokenIn,
      tokenOut: q.tokenOut,
      tokenInSymbol: q.tokenInSymbol,
      tokenOutSymbol: q.tokenOutSymbol,
    });
    const improvementBps =
      BigInt(bot.amountOut) > 0n
        ? Number(
            ((BigInt(human.amountOut) - BigInt(bot.amountOut)) * 10_000n) /
              BigInt(bot.amountOut),
          )
        : 0;
    return c.json({
      amountIn: amountIn.toString(),
      comparisonAmountIn: amountIn.toString(),
      direction: human.direction,
      zeroForOne: human.direction === 'tETH-to-tUSD',
      tokenIn: human.tokenIn,
      tokenOut: human.tokenOut,
      tokenInSymbol: human.tokenInSymbol,
      tokenOutSymbol: human.tokenOutSymbol,
      feeSchedule: {
        tightFeeBps: human.feeSchedule.tightFeeBps,
        wideFeeBps: human.feeSchedule.wideFeeBps,
        targetFeeBps: human.feeSchedule.targetFeeBps,
        humanShareBps: human.feeSchedule.humanShareBps,
        tightVolume: human.feeSchedule.tightVolume,
        wideVolume: human.feeSchedule.wideVolume,
      },
      human: row(
        'World ID-verified retail',
        human,
        deployments.humanAgent,
        amountIn,
      ),
      bot: row('HFT / arbitrage flow', bot, deployments.bot, amountIn),
      sybil: {
        ...row(
          'Sybil twin (same human)',
          sybil,
          deployments.sybilAgent,
          sybilAmountIn,
        ),
        sharedQuotaRemaining: remaining.toString(),
        proof:
          sybilAmountIn === remaining + 1n
            ? 'quoted amount is exactly one wei above the quota wallet #1 left for this humanId'
            : 'the shared human quota is exhausted; this executable quote remains in the wide lane',
      },
      improvementBps,
      rationale:
        'Sybil-resistant per-human quotas bound the LP’s maximum adverse-selection exposure; the tighter quote prices that lower risk.',
    });
  } catch (error) {
    return liveReadErrorResponse(c, error);
  }
};

app.get('/market/quotes', marketQuotes);

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
      await quoteWebsiteWallet(c.req.query('address'), amountIn, direction),
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

app.get('/identity/status', async (c) => {
  try {
    return c.json(await worldIdentityStatus(c.req.query('address')));
  } catch (error) {
    if (/wallet address|not configured/i.test(errorDescription(error))) {
      return c.json(
        {
          code: 'invalid_identity_request',
          error: error instanceof Error ? error.message : 'invalid identity request',
          retryable: false,
          status: 400,
        },
        400,
      );
    }
    return liveReadErrorResponse(c, error);
  }
});

app.post('/identity/register', async (c) => {
  try {
    const body = (await c.req.json()) as AgentBookRegistration;
    parseIdentityAddress(body.agent);
    return c.json(await relayAgentBookRegistration(body));
  } catch (error) {
    const description = errorDescription(error);
    const status = /malformed|different AgentBook|wallet address/i.test(description) ? 400 : 502;
    return c.json(
      {
        code: 'world_registration_failed',
        error: error instanceof Error ? error.message : 'World registration failed',
        retryable: status === 502,
        status,
      },
      status,
    );
  }
});

app.post('/wallet/prepare', async (c) => {
  const allowedOrigin = process.env.MARKET_TRADE_ORIGIN;
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
  let body: { address?: unknown; amountIn?: unknown; direction?: unknown; slippageBps?: unknown };
  try {
    body = await c.req.json();
    const amountIn = parseQuoteAmount(
      typeof body.amountIn === 'string' ? body.amountIn : undefined,
    );
    const direction = parseDemoTradeDirection(body.direction);
    return c.json(
      await prepareWebsiteWalletTrade(body.address, amountIn, direction, parseSlippageBps(body.slippageBps)),
    );
  } catch (error) {
    const description = errorDescription(error);
    if (/wallet must|amountIn|direction must|slippageBps|insufficient .* balance/i.test(description)) {
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
  const allowedOrigin = process.env.MARKET_TRADE_ORIGIN;
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
      await confirmWebsiteWalletTrade(
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

app.post('/market/trade', async (c) => {
  if (!marketTradesEnabled()) {
    const safeError = describeTradeError(
      new Error('server-operated market trades are disabled on this runtime'),
    );
    return c.json(safeError, safeError.status);
  }
  const allowedOrigin = process.env.MARKET_TRADE_ORIGIN;
  const requestOrigin = c.req.header('origin');
  if (allowedOrigin && requestOrigin !== allowedOrigin) {
    return c.json(
      {
        code: 'trade_forbidden',
        error: 'market trades must be submitted from the configured dashboard',
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
        const result = await executeMarketTrade(
          body.lane as DemoTradeLane,
          amountIn,
          direction,
          async (progress) => send({ type: 'progress', progress }),
        );
        await send({ type: 'result', result });
      } catch (error) {
        console.error('[turing-pool] streamed market trade failed', error);
        await send({ type: 'error', error: describeTradeError(error) });
      }
    });
  }

  try {
    return c.json(await executeMarketTrade(body.lane as DemoTradeLane, amountIn, direction));
  } catch (error) {
    console.error('[turing-pool] market trade failed', error);
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
    const [state, latestBlock, rpcChainId, index, humanId] = await Promise.all([
      websitePoolState(),
      client.getBlockNumber({ cacheTime: 0 }),
      client.getChainId(),
      activityIndex(),
      lookupHuman(deployments.humanAgent),
    ]);
    if (index.status !== 'connected' || (rpcChainId === 480 && index.mode !== 'sql+mcp')) {
      return c.json(
        {
          code: 'indexer_unavailable',
          error:
            rpcChainId === 480
              ? 'Nuthatch has not confirmed the live market state yet. Wait for the on-chain indexer to catch up.'
              : 'The local execution index has not confirmed market state yet.',
          retryable: true,
          retryAfterSeconds: 5,
          status: 503,
        },
        503,
      );
    }
    if (humanId === 0n) {
      throw new Error(
        'configured World ID-verified wallet is not registered in AgentBook',
      );
    }
    const strategies = configuredStrategyHistory(
      state.strategy,
      state.strategyHash,
    );
    const swaps = index.swaps;
    const feeHistory = index.feeHistory;
    const indexMetadata = {
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
      riskWindow: index.riskWindow,
    };
    const [remEth, remUsd, cap0, cap1] = await Promise.all([
      quotaRemaining(humanId, state.strategy.token0, state.program.quota),
      quotaRemaining(humanId, state.strategy.token1, state.program.quota),
      dailyCap(state.strategy.token0, state.program.quota),
      dailyCap(state.strategy.token1, state.program.quota),
    ]);
    const tightSwaps = swaps.filter((s) => s.tight);
    const wideSwaps = swaps.filter((s) => !s.tight);
    return c.json({
      contracts: {
        aqua: deployments.aqua,
        agentBook: deployments.agentBook,
        app: deployments.app,
        router: state.router,
        quota: state.program.quota,
        mockAgentBook: deployments.mockAgentBook,
        vaultFactory: process.env.VAULT_FACTORY ?? deployments.vaultFactory,
        vaultRouter: deployments.vaultRouter,
        activeVault: deployments.activeVault,
        activeVaultQuota: deployments.activeVaultQuota,
        faucet: process.env.FAUCET_ADDRESS ?? deployments.faucet,
      },
      execution: {
        enabled: true,
        serverOperated: marketTradesEnabled(),
        venue: 'SwapVM',
        opcode: state.program.opcode,
        instruction: '_humanGate',
        event: 'HumanGated',
        router: state.router,
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
        name: index.mode === 'sql+mcp' ? 'Nuthatch · SQL + MCP' : 'Local chain event scan',
        },
        strategist: {
          ...indexMetadata,
          name: 'Nuthatch semantic activity layer',
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
      verifiedTrader: {
        humanId: humanId.toString(),
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
      riskPolicy: {
        updater: state.riskPolicy.updater,
        maxFeeStepBps: state.riskPolicy.maxFeeStepBps.toString(),
        maxDataLagBlocks: state.riskPolicy.maxDataLagBlocks.toString(),
        indexedThroughBlock: state.riskPolicy.indexedThroughBlock.toString(),
        decisionHash: state.riskPolicy.decisionHash,
        desiredTightFeeBps: state.riskPolicy.desiredTightFeeBps.toString(),
        riskSpreadBps: state.riskPolicy.riskSpreadBps.toString(),
        source: 'Nuthatch turing_risk_window',
      },
      strategyHistory: strategies,
      swaps,
      feeHistory,
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

app.get('/faucet', async (c) => {
  try {
    return c.json(await faucetState(c.req.query('address')));
  } catch (error) {
    return faucetRequestError(c, error);
  }
});

app.post('/faucet/prepare', async (c) => {
  if (!vaultOriginAllowed(c)) {
    return c.json(
      {
        code: 'faucet_forbidden',
        error: 'faucet claims must be submitted from the configured dashboard',
        retryable: false,
        status: 403,
      },
      403,
    );
  }
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    return c.json(await prepareFaucetClaim(body.address));
  } catch (error) {
    return faucetRequestError(c, error);
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
