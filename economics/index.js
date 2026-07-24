const BPS_SCALE = 10_000n;
const DISPLAY_SCALE = 1_000_000n;

export const DEFAULT_REVENUE_POLICY = Object.freeze({
  targetFeeBps: 19,
  desiredTightFeeBps: 5,
  minTightFeeBps: 2,
  maxWideFeeBps: 100,
});

function asVolume(value, name) {
  const volume = typeof value === 'bigint' ? value : BigInt(value);
  if (volume < 0n) throw new RangeError(`${name} must be non-negative`);
  return volume;
}

function asFee(value, name) {
  if (!Number.isInteger(value) || value < 0 || value >= Number(BPS_SCALE)) {
    throw new RangeError(`${name} must be an integer between 0 and 9999 bps`);
  }
  return value;
}

function roundedDivide(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function decimalRatio(numerator, denominator) {
  if (denominator === 0n) return 0;
  return Number((numerator * DISPLAY_SCALE) / denominator) / Number(DISPLAY_SCALE);
}

/**
 * Solves a two-tier fee schedule against a fixed blended LP fee target.
 *
 * The controller observes normalized tight- and wide-tier notional over one
 * activity window. It lowers the tight fee toward the desired retail fee, then
 * solves the wide fee so:
 *
 *   tightVolume * tightFee + wideVolume * wideFee
 *     ~= (tightVolume + wideVolume) * targetFee
 *
 * Fees are integer basis points, so the result reports any rounding drift.
 * When the observed bot share cannot fund a discount within maxWideFeeBps, the
 * controller raises the tight fee toward the target. If no valid separated
 * schedule exists, it holds the current schedule.
 */
export function calculateRevenueNeutralFees(input) {
  const tightVolume = asVolume(input.tightVolume, 'tightVolume');
  const wideVolume = asVolume(input.wideVolume, 'wideVolume');
  const currentTightFeeBps = asFee(input.currentTightFeeBps, 'currentTightFeeBps');
  const currentWideFeeBps = asFee(input.currentWideFeeBps, 'currentWideFeeBps');
  const targetFeeBps = asFee(input.targetFeeBps, 'targetFeeBps');
  const minTightFeeBps = asFee(input.minTightFeeBps ?? 2, 'minTightFeeBps');
  const maxWideFeeBps = asFee(input.maxWideFeeBps ?? 100, 'maxWideFeeBps');
  const desiredTightFeeBps = Math.max(
    minTightFeeBps,
    Math.min(asFee(input.desiredTightFeeBps, 'desiredTightFeeBps'), targetFeeBps - 1),
  );

  if (currentTightFeeBps > currentWideFeeBps) {
    throw new RangeError('currentTightFeeBps must not exceed currentWideFeeBps');
  }
  if (targetFeeBps <= minTightFeeBps || maxWideFeeBps <= targetFeeBps) {
    throw new RangeError('fee bounds must allow tight < target < wide');
  }

  const totalVolume = tightVolume + wideVolume;
  const targetFeeUnits = totalVolume * BigInt(targetFeeBps);
  const humanShareBps =
    totalVolume === 0n ? 0 : Number((tightVolume * BPS_SCALE) / totalVolume);

  const build = (tightFeeBps, wideFeeBps, status, canAdjust) => {
    const projectedFeeUnits =
      tightVolume * BigInt(tightFeeBps) + wideVolume * BigInt(wideFeeBps);
    const signedDelta = projectedFeeUnits - targetFeeUnits;
    return {
      tightFeeBps,
      wideFeeBps,
      targetFeeBps,
      projectedWeightedFeeBps: decimalRatio(projectedFeeUnits, totalVolume),
      revenueDeltaBps: decimalRatio(signedDelta, totalVolume),
      humanShareBps,
      tightVolume: tightVolume.toString(),
      wideVolume: wideVolume.toString(),
      status,
      canAdjust,
      formula:
        'tightVolume × tightFee + wideVolume × wideFee ≈ totalVolume × targetFee',
    };
  };

  if (totalVolume === 0n) {
    return build(currentTightFeeBps, currentWideFeeBps, 'no-activity', false);
  }
  if (tightVolume === 0n) {
    return build(currentTightFeeBps, currentWideFeeBps, 'insufficient-tight-flow', false);
  }
  if (wideVolume === 0n) {
    return build(currentTightFeeBps, currentWideFeeBps, 'insufficient-wide-flow', false);
  }

  for (let tightFeeBps = desiredTightFeeBps; tightFeeBps < targetFeeBps; tightFeeBps += 1) {
    const wideFeeUnits =
      targetFeeUnits - tightVolume * BigInt(tightFeeBps);
    const wideFeeBps = Number(roundedDivide(wideFeeUnits, wideVolume));
    if (wideFeeBps <= targetFeeBps || wideFeeBps > maxWideFeeBps) continue;

    const projectedFeeUnits =
      tightVolume * BigInt(tightFeeBps) + wideVolume * BigInt(wideFeeBps);
    const status = projectedFeeUnits === targetFeeUnits ? 'balanced' : 'rounded';
    const canAdjust =
      tightFeeBps !== currentTightFeeBps || wideFeeBps !== currentWideFeeBps;
    return build(
      tightFeeBps,
      wideFeeBps,
      canAdjust ? status : 'already-balanced',
      canAdjust,
    );
  }

  return build(currentTightFeeBps, currentWideFeeBps, 'capacity-limited', false);
}
