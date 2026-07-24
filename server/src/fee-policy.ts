import {
  calculateRevenueNeutralFees,
  DEFAULT_REVENUE_POLICY,
  type RevenueNeutralFeeDecision,
} from '../../economics/index.js';

interface ActivitySwap {
  tight: boolean;
  tokenIn: string;
  amountIn: string;
  amountOut: string;
}

interface ActivePool {
  token0: string;
  tightFeeBps: bigint | string | number;
  wideFeeBps: bigint | string | number;
}

export interface ActivityFeePolicy extends RevenueNeutralFeeDecision {
  observedSwaps: number;
  tightSwaps: number;
  wideSwaps: number;
  normalization: string;
  source: 'event-derived-recommendation' | 'on-chain-volume-controller';
}

/**
 * Normalizes both swap directions into token0 notional. For token0 -> token1,
 * amountIn is already token0. For token1 -> token0, amountOut is token0.
 * This keeps opposite-direction ERC-20 decimals out of the fee-mix equation.
 */
export function activityFeePolicy(
  swaps: ActivitySwap[],
  pool: ActivePool,
): ActivityFeePolicy {
  const token0 = pool.token0.toLowerCase();
  let tightVolume = 0n;
  let wideVolume = 0n;
  let tightSwaps = 0;
  let wideSwaps = 0;

  for (const swap of swaps) {
    const normalizedToken0Volume =
      swap.tokenIn.toLowerCase() === token0
        ? BigInt(swap.amountIn)
        : BigInt(swap.amountOut);
    if (swap.tight) {
      tightVolume += normalizedToken0Volume;
      tightSwaps += 1;
    } else {
      wideVolume += normalizedToken0Volume;
      wideSwaps += 1;
    }
  }

  return {
    ...calculateRevenueNeutralFees({
      ...DEFAULT_REVENUE_POLICY,
      tightVolume,
      wideVolume,
      currentTightFeeBps: Number(pool.tightFeeBps),
      currentWideFeeBps: Number(pool.wideFeeBps),
    }),
    observedSwaps: swaps.length,
    tightSwaps,
    wideSwaps,
    normalization:
      'recent swaps normalized to token0 notional; reverse fills use token0 amountOut',
    source: 'event-derived-recommendation',
  };
}

interface OnChainSchedule {
  tightFeeBps: bigint;
  wideFeeBps: bigint;
  targetFeeBps: bigint;
  humanShareBps: bigint;
  tightVolume: bigint;
  wideVolume: bigint;
}

function decimalRatio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  const scale = 1_000_000n;
  return Number((numerator * scale) / denominator) / Number(scale);
}

/** Presents the schedule enforced by HumanQuota, rather than an off-chain recommendation. */
export function onChainFeePolicy(
  schedule: OnChainSchedule,
  counts: { observedSwaps: number; tightSwaps: number; wideSwaps: number },
): ActivityFeePolicy {
  const totalVolume = schedule.tightVolume + schedule.wideVolume;
  const realizedRevenue =
    schedule.tightVolume * schedule.tightFeeBps +
    schedule.wideVolume * schedule.wideFeeBps;
  const targetRevenue = totalVolume * schedule.targetFeeBps;
  return {
    tightFeeBps: Number(schedule.tightFeeBps),
    wideFeeBps: Number(schedule.wideFeeBps),
    targetFeeBps: Number(schedule.targetFeeBps),
    projectedWeightedFeeBps: decimalRatio(realizedRevenue, totalVolume),
    revenueDeltaBps: decimalRatio(realizedRevenue - targetRevenue, totalVolume),
    humanShareBps: Number(schedule.humanShareBps),
    tightVolume: schedule.tightVolume.toString(),
    wideVolume: schedule.wideVolume.toString(),
    status: totalVolume === 0n ? 'no-activity' : 'already-balanced',
    canAdjust: true,
    formula:
      'executed tight notional × tight fee + executed wide notional × wide fee ≈ total notional × LP target',
    ...counts,
    normalization: 'executed input notional recorded by HumanQuota on-chain',
    source: 'on-chain-volume-controller',
  };
}
