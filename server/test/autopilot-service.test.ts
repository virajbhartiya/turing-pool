import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAutopilotPlan, type AutopilotEvidence } from '../src/autopilot.js';
import { AutopilotStore, AutopilotService, type AutopilotDependencies } from '../src/autopilot-service.js';

const owner = '0x1111111111111111111111111111111111111111';
const hash = `0x${'a'.repeat(64)}`;
const evidence: AutopilotEvidence = { source: 'nuthatch', indexedBlock: '100', observedAt: new Date().toISOString(), fills: 5, tightShareBps: 8000, botShareBps: 2000, currentTightFeeBps: 20, currentWideFeeBps: 50, averageExecutionPrice: 2000, priceGapBps: 50, lagBlocks: 2, available: true, provenance: 'test' };
function fixture(path?: string) {
  const store = new AutopilotStore(path);
  const plan = buildAutopilotPlan({ prompt: 'Convert tUSD to tETH', owner, totalAmount: '10', slices: 3 }, evidence);
  store.set({ plan: { ...plan, status: 'active' } });
  const transaction = { from: owner, to: owner, data: '0x1234', value: '0x0' };
  const receipt = { wallet: owner, direction: plan.direction, transactionHash: hash, amountIn: '3', blockNumber: '101', humanBacked: true, tight: true, feeBps: 20 };
  const deps = {
    evidence: async () => evidence, verifyOwner: async () => true, blockNumber: async () => 100n,
    prepare: async () => ({ action: 'swap', transaction, quote: { humanBacked: true, tight: true, feeBps: 20, amountIn: '3' } }),
    confirm: async () => receipt,
    transaction: async () => ({ from: owner, to: owner, input: '0x1234', timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
  } as unknown as AutopilotDependencies;
  return { store, plan, receipt, deps, service: new AutopilotService(store, deps) };
}

test('confirmation without an actual prepared transaction cannot fabricate strategy progress', async () => {
  const { service, plan } = fixture();
  await assert.rejects(service.confirm(plan.id, hash), /prepared/);
});

test('only matching verified owner and passing live policy can prepare a slice', async () => {
  const { service, plan, deps } = fixture();
  await assert.rejects(service.prepare(plan.id, '0x2222222222222222222222222222222222222222'), /owner/);
  deps.evidence = async () => ({ ...evidence, available: false });
  await assert.rejects(service.prepare(plan.id, owner), /policy/);
  deps.evidence = async () => evidence;
  deps.verifyOwner = async () => false;
  await assert.rejects(service.prepare(plan.id, owner), /verified/);
});

test('a connected unverified wallet can prepare and confirm a wider-lane strategy', async () => {
  const { service, plan, deps, receipt } = fixture();
  deps.verifyOwner = async () => false;
  deps.prepare = async () => ({
    action: 'swap',
    transaction: { from: owner, to: owner, data: '0x1234', value: '0x0' },
    quote: { humanBacked: false, tight: false, feeBps: 50, amountIn: '3' },
  });
  Object.assign(receipt, { humanBacked: false, tight: false, feeBps: 50 });
  const prepared = await service.prepare(plan.id, owner);
  assert.equal(prepared.quote.tight, false);
  const confirmed = await service.confirm(plan.id, hash);
  assert.equal(confirmed.executedSlices, 1);
});

test('rejects old, wrong-amount, wrong-wallet, wide-lane, excessive-fee and changed-calldata receipts', async () => {
  for (const mutation of [{ blockNumber: '100' }, { amountIn: '2' }, { wallet: '0x2222' }, { direction: 'tETH-to-tUSD' }, { tight: false }, { feeBps: 200 }]) {
    const { service, plan, receipt } = fixture();
    await service.prepare(plan.id, owner);
    Object.assign(receipt, mutation);
    await assert.rejects(service.confirm(plan.id, hash), /receipt/);
  }
  const { service, plan, deps } = fixture();
  await service.prepare(plan.id, owner);
  deps.transaction = async () => ({ from: owner, to: owner, input: '0xdead', timestamp: BigInt(Math.floor(Date.now() / 1000)) });
  await assert.rejects(service.confirm(plan.id, hash), /transaction/);
});

test('confirmation is idempotent under concurrency, durable, and cannot be replayed across plans', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'autopilot-test-'));
  try {
    const path = join(directory, 'plans.json');
    const { service, store, plan, deps } = fixture(path);
    await service.prepare(plan.id, owner);
    const results = await Promise.all([service.confirm(plan.id, hash), service.confirm(plan.id, hash)]);
    assert.equal(results[0].executedSlices, 1);
    assert.equal(results[1].executedSlices, 1);
    const reloaded = new AutopilotStore(path);
    assert.equal(reloaded.get(plan.id)?.plan.executedSlices, 1);
    const next = buildAutopilotPlan({ prompt: 'Convert tUSD to tETH', owner, totalAmount: '10', slices: 3 }, evidence);
    store.set({ plan: { ...next, status: 'active' } });
    await service.prepare(next.id, owner);
    await assert.rejects(service.confirm(next.id, hash), /another strategy/);
    const restarted = new AutopilotService(reloaded, deps);
    assert.equal((await restarted.confirm(plan.id, hash)).executedSlices, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('snapshot, paused, expired and over-fee preparations fail closed', async () => {
  for (const status of ['draft', 'paused', 'completed'] as const) {
    const { service, store, plan } = fixture();
    store.set({ plan: { ...plan, status } });
    await assert.rejects(service.prepare(plan.id, owner), /policy/);
  }
  const snapshot = fixture();
  snapshot.deps.evidence = async () => ({ ...evidence, source: 'snapshot' });
  await assert.rejects(snapshot.service.prepare(snapshot.plan.id, owner), /policy/);
  const expired = fixture();
  expired.store.set({ plan: { ...expired.plan, status: 'active', expiresAt: new Date(0).toISOString() } });
  await assert.rejects(expired.service.prepare(expired.plan.id, owner), /policy/);
  const costly = fixture();
  const base = costly.deps.prepare;
  costly.deps.prepare = async (...args) => { const prepared = await base(...args); return { ...prepared, quote: { ...prepared.quote, feeBps: 200 } }; };
  await assert.rejects(costly.service.prepare(costly.plan.id, owner), /policy/);
});

test('a correctly mined fill is reconciled after pause or indexer failure, but late mining is rejected', async () => {
  const paused = fixture();
  await paused.service.prepare(paused.plan.id, owner);
  await paused.service.evaluate(paused.plan.id, 'paused');
  paused.deps.evidence = async () => { throw new Error('indexer offline'); };
  const result = await paused.service.confirm(paused.plan.id, hash);
  assert.equal(result.executedSlices, 1);
  assert.equal(result.status, 'paused');
  assert.equal(result.evidence.available, false);
  const late = fixture();
  await late.service.prepare(late.plan.id, owner);
  late.deps.transaction = async () => ({ from: owner, to: owner, input: '0x1234', timestamp: BigInt(Math.floor(Date.now() / 1000) + 600) });
  await assert.rejects(late.service.confirm(late.plan.id, hash), /execution window/);
});
