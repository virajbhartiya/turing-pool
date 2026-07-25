import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateRevenueNeutralFees } from './index.js';

const defaults = {
  targetFeeBps: 19,
  riskSpreadBps: 28,
  desiredTightFeeBps: 5,
  currentTightFeeBps: 8,
  currentWideFeeBps: 30,
  minTightFeeBps: 2,
  maxWideFeeBps: 100,
};

test('equal human and bot activity funds a 5 bps retail fee with a 33 bps bot fee', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 100n,
    wideVolume: 100n,
  });

  assert.equal(decision.tightFeeBps, 5);
  assert.equal(decision.wideFeeBps, 33);
  assert.equal(decision.riskSpreadBps, 28);
  assert.equal(decision.projectedWeightedFeeBps, 19);
  assert.equal(decision.revenueDeltaBps, 0);
  assert.equal(decision.status, 'balanced');
});

test('both rates move up the curve when human-backed flow reaches 75 percent', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 300n,
    wideVolume: 100n,
  });

  assert.equal(decision.tightFeeBps, 12);
  assert.equal(decision.wideFeeBps, 40);
  assert.equal(decision.projectedWeightedFeeBps, 19);
  assert.equal(decision.humanShareBps, 7500);
});

test('a two-to-one human mix rounds to 10/37 while preserving the target exactly', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 200n,
    wideVolume: 100n,
  });

  assert.equal(decision.tightFeeBps, 10);
  assert.equal(decision.wideFeeBps, 37);
  assert.equal(decision.projectedWeightedFeeBps, 19);
  assert.equal(decision.status, 'balanced');
});

test('both rates continue upward as human-backed flow reaches 90 percent', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 900n,
    wideVolume: 100n,
  });

  assert.equal(decision.tightFeeBps, 16);
  assert.equal(decision.wideFeeBps, 46);
  assert.equal(decision.projectedWeightedFeeBps, 19);
});

test('a capped wide lane recomputes the tight lane from residual target revenue', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 900n,
    wideVolume: 100n,
    maxWideFeeBps: 30,
  });

  assert.equal(decision.tightFeeBps, 18);
  assert.equal(decision.wideFeeBps, 30);
  assert.equal(decision.projectedWeightedFeeBps, 19.2);
  assert.equal(decision.status, 'rounded');
});

test('no activity preserves the configured schedule', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 0n,
    wideVolume: 0n,
  });

  assert.equal(decision.canAdjust, false);
  assert.equal(decision.tightFeeBps, defaults.currentTightFeeBps);
  assert.equal(decision.wideFeeBps, defaults.currentWideFeeBps);
  assert.equal(decision.status, 'no-activity');
});

test('the tight-only endpoint puts the active lane at target and unused lane at target plus spread', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 100n,
    wideVolume: 0n,
  });

  assert.equal(decision.tightFeeBps, 19);
  assert.equal(decision.wideFeeBps, 47);
  assert.equal(decision.projectedWeightedFeeBps, 19);
  assert.equal(decision.status, 'balanced');
});

test('the wide-only endpoint keeps the tight floor and puts the active lane at target', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 0n,
    wideVolume: 100n,
  });

  assert.equal(decision.tightFeeBps, 5);
  assert.equal(decision.wideFeeBps, 19);
  assert.equal(decision.projectedWeightedFeeBps, 19);
  assert.equal(decision.status, 'balanced');
});

test('integer fee rounding is explicit and bounded to at most half a blended basis point', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 1n,
    wideVolume: 18n,
  });

  assert.equal(decision.tightFeeBps, 5);
  assert.equal(decision.wideFeeBps, 20);
  assert.ok(Math.abs(decision.revenueDeltaBps) <= 0.5);
  assert.equal(decision.status, 'rounded');
});
