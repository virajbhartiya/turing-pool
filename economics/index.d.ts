export interface RevenueNeutralFeeInput {
  tightVolume: bigint | string | number;
  wideVolume: bigint | string | number;
  currentTightFeeBps: number;
  currentWideFeeBps: number;
  targetFeeBps: number;
  riskSpreadBps?: number;
  /** Tight-lane floor used after rounding the two-sided curve. */
  desiredTightFeeBps?: number;
  /** @deprecated HumanQuota uses desiredTightFeeBps as its tight floor. */
  minTightFeeBps?: number;
  maxWideFeeBps?: number;
}

export type RevenueNeutralFeeStatus =
  | 'balanced'
  | 'rounded'
  | 'already-balanced'
  | 'no-activity'
  | 'insufficient-tight-flow'
  | 'insufficient-wide-flow'
  | 'capacity-limited';

export interface RevenueNeutralFeeDecision {
  tightFeeBps: number;
  wideFeeBps: number;
  targetFeeBps: number;
  riskSpreadBps: number;
  projectedWeightedFeeBps: number;
  revenueDeltaBps: number;
  humanShareBps: number;
  tightVolume: string;
  wideVolume: string;
  status: RevenueNeutralFeeStatus;
  canAdjust: boolean;
  formula: string;
}

export const DEFAULT_REVENUE_POLICY: Readonly<{
  targetFeeBps: 19;
  riskSpreadBps: 28;
  desiredTightFeeBps: 5;
  minTightFeeBps: 2;
  maxWideFeeBps: 100;
}>;

export function calculateRevenueNeutralFees(
  input: RevenueNeutralFeeInput,
): RevenueNeutralFeeDecision;
