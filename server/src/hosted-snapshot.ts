import { activityFeePolicy } from './fee-policy.js';
import type { DemoTradeDirection } from './demo.js';

const ADDRESSES = {
  aqua: '0x499943E74FB0cE105688beeE8Ef2ABec5D936d31',
  agentBook: '0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4',
  app: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
  router: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
  quota: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  token0: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
  token1: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
  maker: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  bot: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  human: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  sybil: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
} as const;

const HUMAN_ID = '3203383023';
const TOKEN_SCALE = 10n ** 18n;
const PRICE = 100n;
const TIGHT_FEE_BPS = 13n;
const WIDE_FEE_BPS = 41n;
const QUOTA_REMAINING = 2n * TOKEN_SCALE;
const QUOTA_REMAINING_TUSD = 20_000n * TOKEN_SCALE;
const DAILY_CAP = 10n * TOKEN_SCALE;

function amountOut(
  amountIn: bigint,
  feeBps: bigint,
  direction: DemoTradeDirection = 'tETH-to-tUSD',
): bigint {
  const amountAfterFee = amountIn * (10_000n - feeBps);
  return direction === 'tETH-to-tUSD'
    ? (amountAfterFee * PRICE) / 10_000n
    : amountAfterFee / (10_000n * PRICE);
}

export function hostedDemoQuotes(
  amountIn: bigint,
  direction: DemoTradeDirection = 'tETH-to-tUSD',
) {
  const zeroForOne = direction === 'tETH-to-tUSD';
  const tokenIn = zeroForOne ? ADDRESSES.token0 : ADDRESSES.token1;
  const tokenOut = zeroForOne ? ADDRESSES.token1 : ADDRESSES.token0;
  const tokenInSymbol = zeroForOne ? 'tETH' : 'tUSD';
  const tokenOutSymbol = zeroForOne ? 'tUSD' : 'tETH';
  const quotaRemaining = zeroForOne ? QUOTA_REMAINING : QUOTA_REMAINING_TUSD;
  const humanOut = amountOut(amountIn, TIGHT_FEE_BPS, direction);
  const botOut = amountOut(amountIn, WIDE_FEE_BPS, direction);
  const sybilAmount = quotaRemaining + 1n;
  const route = {
    direction,
    zeroForOne,
    tokenIn,
    tokenOut,
    tokenInSymbol,
    tokenOutSymbol,
  };

  return {
    mode: 'hosted-preview-snapshot',
    ...route,
    amountIn: amountIn.toString(),
    comparisonAmountIn: amountIn.toString(),
    feeSchedule: {
      tightFeeBps: TIGHT_FEE_BPS.toString(),
      wideFeeBps: WIDE_FEE_BPS.toString(),
      targetFeeBps: '30',
      humanShareBps: '3999',
      tightVolume: (2n * TOKEN_SCALE).toString(),
      wideVolume: (3n * TOKEN_SCALE + 1n).toString(),
    },
    human: {
      ...route,
      label: 'World ID-verified retail',
      address: ADDRESSES.human,
      amountIn: amountIn.toString(),
      tier: 'tight',
      feeBps: TIGHT_FEE_BPS.toString(),
      amountOut: humanOut.toString(),
      humanId: HUMAN_ID,
    },
    bot: {
      ...route,
      label: 'HFT / arbitrage flow',
      address: ADDRESSES.bot,
      amountIn: amountIn.toString(),
      tier: 'wide',
      feeBps: WIDE_FEE_BPS.toString(),
      amountOut: botOut.toString(),
      humanId: null,
    },
    sybil: {
      ...route,
      label: 'Sybil twin (same human)',
      address: ADDRESSES.sybil,
      amountIn: sybilAmount.toString(),
      tier: 'wide',
      feeBps: WIDE_FEE_BPS.toString(),
      amountOut: amountOut(sybilAmount, WIDE_FEE_BPS, direction).toString(),
      humanId: HUMAN_ID,
      sharedQuotaRemaining: quotaRemaining.toString(),
      proof: 'snapshot models an amount exactly one wei above the shared per-human quota',
    },
    improvementBps:
      botOut > 0n ? Number(((humanOut - botOut) * 10_000n) / botOut) : 0,
    rationale:
      'Sybil-resistant per-human quotas bound the LP’s maximum adverse-selection exposure; the tighter quote prices that lower risk.',
  };
}

export function hostedState() {
  const initialHash =
    '0x9716810ec8ec91ed8a24b2a624f434dc5da66532859b51bb30d0a6130d101a94';
  const activeHash =
    '0xe5e4a6912b90eb0008a219dca2156c3fa299eca184911bcfc02de7187669ecd7';

  const state = {
    contracts: {
      aqua: ADDRESSES.aqua,
      agentBook: ADDRESSES.agentBook,
      app: ADDRESSES.app,
      router: ADDRESSES.router,
      quota: ADDRESSES.quota,
      mockAgentBook: false,
    },
    runtime: {
      mode: 'hosted-preview',
      label: 'Hosted preview · deterministic demo snapshot',
      agentBook: 'snapshot-only',
      chainId: 8453,
      latestBlock: 'snapshot',
      rpcStatus: 'not-used',
    },
    dataSources: {
      quotes: {
        name: 'Deterministic hosted preview',
        status: 'snapshot',
        block: 'snapshot',
      },
      strategy: {
        name: 'Recorded Aqua demo lifecycle',
        status: 'snapshot',
        historyEntries: 2,
      },
      activity: {
        name: 'Recorded activity snapshot',
        configured: false,
        endpoint: null,
        status: 'snapshot',
        indexedBlock: null,
        fallback: null,
      },
      strategist: {
        name: 'Hosted deterministic snapshot',
        configured: false,
        endpoint: null,
        status: 'snapshot',
        indexedBlock: null,
        hasIndexingErrors: null,
      },
    },
    pool: {
      strategyHash: activeHash,
      token0: ADDRESSES.token0,
      token1: ADDRESSES.token1,
      balance0: (1_000n * TOKEN_SCALE).toString(),
      balance1: (100_000n * TOKEN_SCALE).toString(),
      wideFeeBps: WIDE_FEE_BPS.toString(),
      tightFeeBps: TIGHT_FEE_BPS.toString(),
    },
    demoHuman: {
      humanId: HUMAN_ID,
      quotaRemainingToken0: QUOTA_REMAINING.toString(),
      quotaRemainingToken1: (20_000n * TOKEN_SCALE).toString(),
      dailyCapToken0: DAILY_CAP.toString(),
      dailyCapToken1: (100_000n * TOKEN_SCALE).toString(),
    },
    stats: {
      totalSwaps: 4,
      tightSwaps: 2,
      wideSwaps: 2,
    },
    strategyHistory: [
      {
        blockNumber: 'preview-1',
        transactionHash: null,
        strategyHash: initialHash,
        active: false,
        kind: 'initial-ship',
        from: null,
        to: { tightFeeBps: '16', wideFeeBps: '44' },
      },
      {
        blockNumber: 'preview-2',
        transactionHash: null,
        strategyHash: activeHash,
        active: true,
        kind: 'repriced',
        from: { tightFeeBps: '16', wideFeeBps: '44' },
        to: { tightFeeBps: '13', wideFeeBps: '41' },
      },
    ],
    swaps: [
      {
        blockNumber: 'preview-1',
        transactionHash: null,
        taker: ADDRESSES.bot,
        humanId: '0',
        tight: false,
        tokenIn: ADDRESSES.token0,
        tokenOut: ADDRESSES.token1,
        amountIn: TOKEN_SCALE.toString(),
        amountOut: amountOut(TOKEN_SCALE, WIDE_FEE_BPS).toString(),
        feeBps: WIDE_FEE_BPS.toString(),
      },
      {
        blockNumber: 'preview-2',
        transactionHash: null,
        taker: ADDRESSES.human,
        humanId: HUMAN_ID,
        tight: true,
        tokenIn: ADDRESSES.token0,
        tokenOut: ADDRESSES.token1,
        amountIn: TOKEN_SCALE.toString(),
        amountOut: amountOut(TOKEN_SCALE, TIGHT_FEE_BPS).toString(),
        feeBps: TIGHT_FEE_BPS.toString(),
      },
      {
        blockNumber: 'preview-3',
        transactionHash: null,
        taker: ADDRESSES.sybil,
        humanId: HUMAN_ID,
        tight: false,
        tokenIn: ADDRESSES.token0,
        tokenOut: ADDRESSES.token1,
        amountIn: (QUOTA_REMAINING + 1n).toString(),
        amountOut: amountOut(QUOTA_REMAINING + 1n, WIDE_FEE_BPS).toString(),
        feeBps: WIDE_FEE_BPS.toString(),
      },
      {
        blockNumber: 'preview-4',
        transactionHash: null,
        taker: ADDRESSES.human,
        humanId: HUMAN_ID,
        tight: true,
        tokenIn: ADDRESSES.token0,
        tokenOut: ADDRESSES.token1,
        amountIn: TOKEN_SCALE.toString(),
        amountOut: amountOut(TOKEN_SCALE, TIGHT_FEE_BPS).toString(),
        feeBps: TIGHT_FEE_BPS.toString(),
      },
    ],
  };
  return {
    ...state,
    feeController: activityFeePolicy(state.swaps, state.pool),
  };
}
