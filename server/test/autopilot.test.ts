import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAutopilotPlan,
  updateAutopilotPlan,
  type AutopilotEvidence,
} from '../src/autopilot.js';

const evidence: AutopilotEvidence = {
  source: 'nuthatch',
  indexedBlock: '34580000',
  observedAt: '2026-09-04T08:00:00.000Z',
  fills: 19,
  tightShareBps: 5_600,
  botShareBps: 4_400,
  currentTightFeeBps: 23,
  currentWideFeeBps: 51,
  averageExecutionPrice: 1_900,
  priceGapBps: 85,
  lagBlocks: 2,
  available: true,
  provenance: 'sql+mcp · registry 0x1234',
};

test('builds a bounded conditional DCA plan from natural language', () => {
  const plan = buildAutopilotPlan(
    {
      prompt: 'Convert 500 tUSD to tETH in 5 slices when bot activity is below 50% and fee is under 30 bps',
      owner: '0x1111111111111111111111111111111111111111',
    },
    evidence,
    new Date('2026-09-04T08:00:00.000Z'),
  );

  assert.equal(plan.direction, 'tUSD-to-tETH');
  assert.equal(plan.totalAmount, (500n * 10n ** 18n).toString());
  assert.equal(plan.sliceAmount, (100n * 10n ** 18n).toString());
  assert.equal(plan.slices, 5);
  assert.equal(plan.conditions.maxBotShareBps, 5_000);
  assert.equal(plan.conditions.maxFeeBps, 30);
  assert.equal(plan.decision, 'execute');
  assert.match(plan.decisionHash, /^0x[0-9a-f]{64}$/);
});

test('fails closed when Nuthatch evidence is unavailable', () => {
  const plan = buildAutopilotPlan(
    { prompt: 'Buy 500 tUSD in five slices', owner: '0x1111111111111111111111111111111111111111' },
    { ...evidence, available: false, indexedBlock: null },
  );

  assert.equal(plan.decision, 'wait');
  assert.match(plan.decisionSummary, /fails closed/i);
});

test('waits when a live market guard is outside policy', () => {
  const plan = buildAutopilotPlan(
    {
      prompt: 'Convert 500 tUSD to tETH',
      owner: '0x1111111111111111111111111111111111111111',
      maxBotShareBps: 2_500,
    },
    evidence,
  );

  assert.equal(plan.decision, 'wait');
  assert.equal(plan.checks.find((check) => check.key === 'bot-share')?.passed, false);
});

test('human pause overrides an otherwise executable decision', () => {
  const plan = buildAutopilotPlan(
    { prompt: 'Convert 500 tUSD to tETH', owner: '0x1111111111111111111111111111111111111111' },
    evidence,
  );
  const paused = updateAutopilotPlan(plan, evidence, 'paused');

  assert.equal(paused.status, 'paused');
  assert.equal(paused.decision, 'paused');
});

test('remaining budget follows actual receipts and the final slice includes rounding remainder', () => {
  const plan = buildAutopilotPlan({ prompt: 'Convert tUSD to tETH', totalAmount: '10', slices: 3 }, evidence);
  const updated = updateAutopilotPlan({ ...plan, executedSlices: 2, executions: [
    { slice: 1, amountIn: '3', transactionHash: '0x01', confirmedAt: new Date().toISOString() },
    { slice: 2, amountIn: '3', transactionHash: '0x02', confirmedAt: new Date().toISOString() },
  ] }, evidence, 'active');
  assert.equal(updated.remainingAmount, '4');
  assert.equal(updated.sliceAmount, '4');
});

test('rejects invalid directions, zero slices and zero-sized slices', () => {
  assert.throws(() => buildAutopilotPlan({ prompt: 'Convert tUSD to tETH', direction: 'invalid' as never }, evidence), /direction/);
  assert.throws(() => buildAutopilotPlan({ prompt: 'Convert tUSD to tETH', slices: 0 }, evidence), /slices/);
  assert.throws(() => buildAutopilotPlan({ prompt: 'Convert tUSD to tETH', totalAmount: '1', slices: 3 }, evidence), /slice/);
});

test('decision digest changes with policy evaluation evidence', () => {
  const plan = buildAutopilotPlan({ prompt: 'Convert tUSD to tETH' }, evidence);
  const updated = updateAutopilotPlan(plan, { ...evidence, indexedBlock: '34580001', available: false });
  assert.notEqual(plan.decisionHash, updated.decisionHash);
});
