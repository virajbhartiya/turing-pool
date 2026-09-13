import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { TransactionReceiptNotFoundError } from 'viem';
import { mountLocalExplorer } from '../src/local-explorer.js';

const hash = `0x${'ab'.repeat(32)}` as const;
const receipt = { transactionHash: hash, status: 'success', blockNumber: 42n,
  gasUsed: 21000n, effectiveGasPrice: 2000000000n,
  from: `0x${'1'.repeat(40)}`, to: `0x${'2'.repeat(40)}` };
function setup(chainId = 31337, mockAgentBook = true, runtimeChainId = 31337,
  getTransactionReceipt = async (_: { hash: `0x${string}` }) => receipt) {
  const app = new Hono();
  mountLocalExplorer(app, { chainId, mockAgentBook, client: {
    getChainId: async () => runtimeChainId, getTransactionReceipt,
  } });
  return app;
}

test('local receipts render actual mined fields and a return link', async () => {
  const response = await setup().request(`/demo/transactions/${hash}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const value of [hash, '42', '21000', '2000000000', 'Confirmed', 'href="/#autopilot"', 'Local demo']) {
    assert.ok(html.includes(value), value);
  }
});

test('explorer is unavailable outside explicit local mock configuration', async () => {
  for (const app of [setup(480), setup(31337, false)]) {
    assert.equal((await app.request(`/demo/transactions/${hash}`)).status, 404);
  }
  assert.equal((await setup(31337, true, 480).request(`/demo/transactions/${hash}`)).status, 503);
});

test('invalid hashes never reach the receipt provider', async () => {
  const app = setup(31337, true, 31337, async () => { throw new Error('must not call'); });
  assert.equal((await app.request('/demo/transactions/0x1234')).status, 400);
});

test('missing receipt and provider failure have distinct responses', async () => {
  const missing = setup(31337, true, 31337, async () => { throw new TransactionReceiptNotFoundError({ hash }); });
  const offline = setup(31337, true, 31337, async () => { throw new Error('private RPC URL'); });
  assert.equal((await missing.request(`/demo/transactions/${hash}`)).status, 404);
  const response = await offline.request(`/demo/transactions/${hash}`);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private RPC URL'));
});

test('reverted receipts remain reverted and provider fields are escaped', async () => {
  const app = setup(31337, true, 31337, async () => ({ ...receipt, status: 'reverted', from: '<script>alert(1)</script>' }));
  const html = await (await app.request(`/demo/transactions/${hash}`)).text();
  assert.ok(html.includes('Reverted'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});
