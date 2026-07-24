import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateRevenueNeutralFees } from './index.js';

const defaults = {
  targetFeeBps: 19,
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
  assert.equal(decision.projectedWeightedFeeBps, 19);
  assert.equal(decision.revenueDeltaBps, 0);
  assert.equal(decision.status, 'balanced');
});

test('the bot surcharge rises as human-backed activity becomes a larger share', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 300n,
    wideVolume: 100n,
  });

  assert.equal(decision.tightFeeBps, 5);
  assert.equal(decision.wideFeeBps, 61);
  assert.equal(decision.projectedWeightedFeeBps, 19);
  assert.equal(decision.humanShareBps, 7500);
});

test('the retail fee moves upward when the bot fee cap cannot fund the full discount', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 900n,
    wideVolume: 100n,
  });

  assert.equal(decision.tightFeeBps, 10);
  assert.equal(decision.wideFeeBps, 100);
  assert.equal(decision.projectedWeightedFeeBps, 19);
  assert.equal(decision.status, 'balanced');
});

test('the controller holds when there is no bot flow to fund a retail discount', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 100n,
    wideVolume: 0n,
  });

  assert.equal(decision.canAdjust, false);
  assert.equal(decision.tightFeeBps, defaults.currentTightFeeBps);
  assert.equal(decision.wideFeeBps, defaults.currentWideFeeBps);
  assert.equal(decision.status, 'insufficient-wide-flow');
});

test('integer fee rounding is explicit and bounded to at most half a blended basis point', () => {
  const decision = calculateRevenueNeutralFees({
    ...defaults,
    tightVolume: 100n,
    wideVolume: 300n,
  });

  assert.equal(decision.tightFeeBps, 5);
  assert.equal(decision.wideFeeBps, 24);
  assert.ok(Math.abs(decision.revenueDeltaBps) <= 0.5);
  assert.equal(decision.status, 'rounded');
});
