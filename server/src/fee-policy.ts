import {
  calculateRevenueNeutralFees,
  DEFAULT_REVENUE_POLICY,
  type RevenueNeutralFeeDecision,
} from '@turing-pool/economics';

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
  };
}
