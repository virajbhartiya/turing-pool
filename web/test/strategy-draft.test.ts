import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStrategyDraft, DEFAULT_STRATEGY_DRAFT } from '../src/lib/strategy-draft';
import { buildAutopilotPlan, type AutopilotEvidence } from '../../server/src/autopilot';

test('structured strategy fields reach the real planner without rounding amounts or changing limits', () => {
  const intent = buildStrategyDraft({ ...DEFAULT_STRATEGY_DRAFT, amount: '0.123456789123456789', direction: 'tETH-to-tUSD', slices: '3', maxFee: '0.27', maxDispersion: '1.25', maxUnverifiedFlow: '62.5', expiresInHours: '72' });
  const evidence: AutopilotEvidence = { source: 'nuthatch', indexedBlock: '100', observedAt: new Date().toISOString(), fills: 10, tightShareBps: 6000, botShareBps: 4000, currentTightFeeBps: 23, currentWideFeeBps: 51, averageExecutionPrice: 2000, priceGapBps: 80, lagBlocks: 0, available: true, provenance: 'test' };
  const plan = buildAutopilotPlan(intent, evidence, new Date('2026-09-08T00:00:00Z'));
  assert.equal(plan.totalAmount, '123456789123456789');
  assert.equal(plan.inputToken, 'tETH');
  assert.equal(plan.outputToken, 'tUSD');
  assert.equal(plan.slices, 3);
  assert.deepEqual(plan.conditions, { maxBotShareBps: 6250, maxFeeBps: 27, maxPriceGapBps: 125 });
  assert.equal(plan.expiresAt, '2026-09-11T00:00:00.000Z');
  assert.equal(plan.status, 'draft');
  assert.equal(plan.executions.length, 0);
});

test('invalid strategy fields are rejected instead of silently clamped by the planner', () => {
  for (const overrides of [{ amount: '0' }, { amount: '1e3' }, { slices: '21' }, { slices: '1.5' }, { maxFee: '3' }, { maxFee: '0.001' }, { maxDispersion: '0' }, { maxUnverifiedFlow: '99' }, { expiresInHours: '169' }]) {
    assert.throws(() => buildStrategyDraft({ ...DEFAULT_STRATEGY_DRAFT, ...overrides }));
  }
  assert.throws(() => buildStrategyDraft({ ...DEFAULT_STRATEGY_DRAFT, amount: '0.000000000000000001', slices: '2' }), /Each trade/);
});
