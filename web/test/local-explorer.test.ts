import assert from 'node:assert/strict';
import test from 'node:test';
import { transactionExplorer } from '../src/lib/format';

test('local Anvil receipts stay on the local explorer rather than a public chain explorer', () => {
  const hash = `0x${'1'.repeat(64)}`;
  assert.equal(transactionExplorer(31337, hash), `/demo/transactions/${hash}`);
  assert.equal(transactionExplorer(480, hash), `https://worldscan.org/tx/${hash}`);
});
