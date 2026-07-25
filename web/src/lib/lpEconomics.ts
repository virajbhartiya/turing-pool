import type { ProtocolState, Swap } from '../types';

const BPS_SCALE = 10_000n;
const RATIO_SCALE = 1_000_000n;

export interface TokenAmounts {
  token0: bigint;
  token1: bigint;
}

export interface TierLpEconomics {
  currentFeeBps: number;
  swapCount: number;
  normalizedVolumeToken0: bigint;
  inputVolume: TokenAmounts;
  impliedFees: TokenAmounts;
}

export interface LpEconomicsOptions {
  token0Decimals?: number;
  token1Decimals?: number;
  /** Live price of one whole token0, denominated in whole token1 units. */
  token0PriceInToken1?: number;
}

export interface LpEconomics {
  human: TierLpEconomics;
  bot: TierLpEconomics;
  total: {
    swapCount: number;
    normalizedVolumeToken0: bigint;
    inputVolume: TokenAmounts;
    impliedFees: TokenAmounts;
  };
  realizedBlendedFeeBps: number | null;
  realizedFeeNotionalToken0: bigint;
  controllerVolumeToken0: bigint;
  projectedBlendedFeeBps: number | null;
  projectedFeeNotionalToken0: bigint;
  targetFeeNotionalToken0: bigint;
  projectedRevenueDeltaToken0: bigint;
  estimatedImpliedFeesToken1?: number;
  estimatedProjectedFeeToken1?: number;
}

export type LpEconomicsState = Pick<ProtocolState, 'pool' | 'feeController' | 'swaps'>;

function emptyAmounts(): TokenAmounts {
  return { token0: 0n, token1: 0n };
}

function addAmounts(left: TokenAmounts, right: TokenAmounts): TokenAmounts {
  return {
    token0: left.token0 + right.token0,
    token1: left.token1 + right.token1,
  };
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator === 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

function ratioAsNumber(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  return Number((numerator * RATIO_SCALE) / denominator) / Number(RATIO_SCALE);
}

function unitsAsNumber(value: bigint, decimals: number): number {
  const scale = 10n ** BigInt(decimals);
  return Number(value / scale) + Number(value % scale) / Number(scale);
}

function parseNonNegative(value: string, label: string): bigint {
  const parsed = BigInt(value);
  if (parsed < 0n) throw new RangeError(`${label} must be non-negative`);
  return parsed;
}

function parseFeeBps(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= Number(BPS_SCALE)) {
    throw new RangeError(`${label} must be an integer between 0 and 9999 bps`);
  }
  return parsed;
}

function swapNotionalToken0(
  swap: Swap,
  token0: string,
  token1: string,
): { inputToken: keyof TokenAmounts; amountIn: bigint; normalizedVolume: bigint; feeBps: number } {
  const input = swap.tokenIn.toLowerCase();
  const output = swap.tokenOut.toLowerCase();
  const amountIn = parseNonNegative(swap.amountIn, 'swap amountIn');
  const amountOut = parseNonNegative(swap.amountOut, 'swap amountOut');
  const feeBps = parseFeeBps(swap.feeBps, 'swap feeBps');

  if (input === token0 && output === token1) {
    return { inputToken: 'token0', amountIn, normalizedVolume: amountIn, feeBps };
  }
  if (input === token1 && output === token0) {
    // Normalize the receipt window to token0-equivalent for analytics. The
    // on-chain controllers remain input-token-specific and never mix units.
    return { inputToken: 'token1', amountIn, normalizedVolume: amountOut, feeBps };
  }
  throw new RangeError('swap token pair does not match the active pool');
}

function createTier(currentFeeBps: number): TierLpEconomics {
  return {
    currentFeeBps,
    swapCount: 0,
    normalizedVolumeToken0: 0n,
    inputVolume: emptyAmounts(),
    impliedFees: emptyAmounts(),
  };
}

/**
 * Derives LP economics from mined swap receipts and the current fee controller.
 *
 * Receipt fees remain separated by input token. Cross-token comparisons use the
 * token0-equivalent receipt analytics; optional token1 estimates require a
 * caller-supplied live mid-price. On-chain fee controllers stay per token.
 */
export function deriveLpEconomics(
  state: LpEconomicsState,
  options: LpEconomicsOptions = {},
): LpEconomics {
  const token0 = state.pool.token0.toLowerCase();
  const token1 = state.pool.token1.toLowerCase();
  if (token0 === token1) throw new RangeError('pool tokens must be distinct');

  const human = createTier(
    parseFeeBps(state.feeController.tightFeeBps, 'current human fee'),
  );
  const bot = createTier(
    parseFeeBps(state.feeController.wideFeeBps, 'current bot fee'),
  );
  let realizedFeeWeight = 0n;

  for (const swap of state.swaps) {
    const { inputToken, amountIn, normalizedVolume, feeBps } =
      swapNotionalToken0(swap, token0, token1);
    const tier = swap.tight ? human : bot;
    tier.swapCount += 1;
    tier.normalizedVolumeToken0 += normalizedVolume;
    tier.inputVolume[inputToken] += amountIn;
    // Both pool execution paths apply the bps fee to input. "Implied" is used
    // because receipts expose amount and rate, not a separately transferred fee.
    tier.impliedFees[inputToken] += ceilDivide(
      amountIn * BigInt(feeBps),
      BPS_SCALE,
    );
    realizedFeeWeight += normalizedVolume * BigInt(feeBps);
  }

  const normalizedVolumeToken0 =
    human.normalizedVolumeToken0 + bot.normalizedVolumeToken0;
  const controllerTightVolume = parseNonNegative(
    state.feeController.tightVolume,
    'controller tight volume',
  );
  const controllerWideVolume = parseNonNegative(
    state.feeController.wideVolume,
    'controller wide volume',
  );
  const controllerVolumeToken0 = controllerTightVolume + controllerWideVolume;
  const targetFeeBps = parseFeeBps(
    state.feeController.targetFeeBps,
    'controller target fee',
  );
  const projectedFeeWeight =
    controllerTightVolume * BigInt(human.currentFeeBps) +
    controllerWideVolume * BigInt(bot.currentFeeBps);
  const targetFeeWeight = controllerVolumeToken0 * BigInt(targetFeeBps);
  const impliedFees = addAmounts(human.impliedFees, bot.impliedFees);
  const inputVolume = addAmounts(human.inputVolume, bot.inputVolume);
  const result: LpEconomics = {
    human,
    bot,
    total: {
      swapCount: human.swapCount + bot.swapCount,
      normalizedVolumeToken0,
      inputVolume,
      impliedFees,
    },
    realizedBlendedFeeBps: ratioAsNumber(
      realizedFeeWeight,
      normalizedVolumeToken0,
    ),
    realizedFeeNotionalToken0: realizedFeeWeight / BPS_SCALE,
    controllerVolumeToken0,
    projectedBlendedFeeBps: ratioAsNumber(
      projectedFeeWeight,
      controllerVolumeToken0,
    ),
    projectedFeeNotionalToken0: projectedFeeWeight / BPS_SCALE,
    targetFeeNotionalToken0: targetFeeWeight / BPS_SCALE,
    projectedRevenueDeltaToken0:
      (projectedFeeWeight - targetFeeWeight) / BPS_SCALE,
  };

  if (options.token0PriceInToken1 !== undefined) {
    const price = options.token0PriceInToken1;
    if (!Number.isFinite(price) || price <= 0) {
      throw new RangeError('token0PriceInToken1 must be a positive finite number');
    }
    const token0Decimals = options.token0Decimals ?? 18;
    const token1Decimals = options.token1Decimals ?? 18;
    if (
      !Number.isInteger(token0Decimals) ||
      token0Decimals < 0 ||
      !Number.isInteger(token1Decimals) ||
      token1Decimals < 0
    ) {
      throw new RangeError('token decimals must be non-negative integers');
    }
    result.estimatedImpliedFeesToken1 =
      unitsAsNumber(impliedFees.token0, token0Decimals) * price +
      unitsAsNumber(impliedFees.token1, token1Decimals);
    result.estimatedProjectedFeeToken1 =
      unitsAsNumber(result.projectedFeeNotionalToken0, token0Decimals) * price;
  }

  return result;
}
