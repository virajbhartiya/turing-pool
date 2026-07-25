const BPS_SCALE = 10_000n;
const DISPLAY_SCALE = 1_000_000n;

export const DEFAULT_REVENUE_POLICY = Object.freeze({
  targetFeeBps: 30,
  riskSpreadBps: 28,
  desiredTightFeeBps: 5,
  // Retained for backwards compatibility. desiredTightFeeBps is the actual
  // on-chain floor used by the two-sided controller.
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
 * activity window. A fixed risk spread defines the continuous two-sided curve:
 *
 *   tightFee = targetFee - riskSpread × wideShare
 *   wideFee  = targetFee + riskSpread × tightShare
 *
 * HumanQuota rounds and clamps the tight lane first. The wide lane then absorbs
 * the remaining target revenue; if it exceeds the cap, the wide fee is capped
 * and the tight fee is recomputed from the residual.
 */
export function calculateRevenueNeutralFees(input) {
  const tightVolume = asVolume(input.tightVolume, 'tightVolume');
  const wideVolume = asVolume(input.wideVolume, 'wideVolume');
  const currentTightFeeBps = asFee(input.currentTightFeeBps, 'currentTightFeeBps');
  const currentWideFeeBps = asFee(input.currentWideFeeBps, 'currentWideFeeBps');
  const targetFeeBps = asFee(input.targetFeeBps, 'targetFeeBps');
  const riskSpreadBps = asFee(input.riskSpreadBps ?? 28, 'riskSpreadBps');
  const desiredTightFeeBps = asFee(
    input.desiredTightFeeBps ?? 5,
    'desiredTightFeeBps',
  );
  const maxWideFeeBps = asFee(input.maxWideFeeBps ?? 100, 'maxWideFeeBps');
  // Validate the legacy field when supplied, but match HumanQuota by clamping
  // to desiredTightFeeBps rather than this older, lower bound.
  if (input.minTightFeeBps !== undefined) {
    asFee(input.minTightFeeBps, 'minTightFeeBps');
  }

  if (currentTightFeeBps > currentWideFeeBps) {
    throw new RangeError('currentTightFeeBps must not exceed currentWideFeeBps');
  }
  if (
    riskSpreadBps === 0 ||
    targetFeeBps < desiredTightFeeBps ||
    maxWideFeeBps < targetFeeBps
  ) {
    throw new RangeError('fee bounds must allow desired tight <= target <= max wide');
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
      riskSpreadBps,
      projectedWeightedFeeBps: decimalRatio(projectedFeeUnits, totalVolume),
      revenueDeltaBps: decimalRatio(signedDelta, totalVolume),
      humanShareBps,
      tightVolume: tightVolume.toString(),
      wideVolume: wideVolume.toString(),
      status,
      canAdjust,
      formula:
        'tightFee = targetFee - riskSpread × wideShare; wideFee = targetFee + riskSpread × tightShare; volume-weighted fees ≈ targetFee',
    };
  };

  if (totalVolume === 0n) {
    return build(currentTightFeeBps, currentWideFeeBps, 'no-activity', false);
  }
  if (tightVolume === 0n) {
    const tightFeeBps = Math.max(
      desiredTightFeeBps,
      targetFeeBps > riskSpreadBps ? targetFeeBps - riskSpreadBps : 0,
    );
    const canAdjust =
      tightFeeBps !== currentTightFeeBps ||
      targetFeeBps !== currentWideFeeBps;
    return build(
      tightFeeBps,
      targetFeeBps,
      canAdjust ? 'balanced' : 'already-balanced',
      canAdjust,
    );
  }
  if (wideVolume === 0n) {
    const wideFeeBps = Math.min(
      targetFeeBps + riskSpreadBps,
      maxWideFeeBps,
    );
    const canAdjust =
      targetFeeBps !== currentTightFeeBps ||
      wideFeeBps !== currentWideFeeBps;
    return build(
      targetFeeBps,
      wideFeeBps,
      canAdjust ? 'balanced' : 'already-balanced',
      canAdjust,
    );
  }

  const spreadRevenueUnits = wideVolume * BigInt(riskSpreadBps);
  let tightFeeBps = 0;
  if (targetFeeUnits > spreadRevenueUnits) {
    tightFeeBps = Number(
      roundedDivide(targetFeeUnits - spreadRevenueUnits, totalVolume),
    );
  }
  tightFeeBps = Math.max(
    desiredTightFeeBps,
    Math.min(tightFeeBps, targetFeeBps),
  );

  const tightRevenueUnits = tightVolume * BigInt(tightFeeBps);
  const requiredWideRevenueUnits =
    targetFeeUnits > tightRevenueUnits
      ? targetFeeUnits - tightRevenueUnits
      : 0n;
  let wideFeeBps = Number(
    roundedDivide(requiredWideRevenueUnits, wideVolume),
  );

  if (wideFeeBps > maxWideFeeBps) {
    wideFeeBps = maxWideFeeBps;
    const wideRevenueUnits = wideVolume * BigInt(wideFeeBps);
    const requiredTightRevenueUnits =
      targetFeeUnits > wideRevenueUnits
        ? targetFeeUnits - wideRevenueUnits
        : 0n;
    tightFeeBps = Number(
      roundedDivide(requiredTightRevenueUnits, tightVolume),
    );
    tightFeeBps = Math.max(
      desiredTightFeeBps,
      Math.min(tightFeeBps, targetFeeBps),
    );
  }

  const canAdjust =
    tightFeeBps !== currentTightFeeBps ||
    wideFeeBps !== currentWideFeeBps;
  const projectedFeeUnits =
    tightVolume * BigInt(tightFeeBps) + wideVolume * BigInt(wideFeeBps);
  const revenueDistance =
    projectedFeeUnits >= targetFeeUnits
      ? projectedFeeUnits - targetFeeUnits
      : targetFeeUnits - projectedFeeUnits;
  const status = !canAdjust
    ? 'already-balanced'
    : projectedFeeUnits === targetFeeUnits
      ? 'balanced'
      : revenueDistance * 2n <= totalVolume
        ? 'rounded'
        : 'capacity-limited';
  return build(tightFeeBps, wideFeeBps, status, canAdjust);
}
