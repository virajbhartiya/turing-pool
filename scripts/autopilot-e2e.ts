import assert from 'node:assert/strict';
import { API_URL, KEYS, makeWallet, publicClient } from '../agent/src/lib.js';
import type { Address, Hex } from 'viem';

// Only runs against the isolated Anvil chain started by e2e.sh. Never uses public-chain keys.
assert.equal(await publicClient.getChainId(), 31337, 'Strategy E2E is restricted to Anvil');
const wallet = makeWallet(KEYS.humanAgent);
const planId = process.argv[2];
assert.ok(planId, 'Pass the freshly activated plan ID');
async function request(path: string, body: object) {
  const response = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json() as any;
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(result)}`);
  return result;
}
const fake = await fetch(`${API_URL}/autopilot/${planId}/confirm`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactionHash: `0x${'f'.repeat(64)}` }),
});
assert.equal(fake.status, 400, 'An unprepared fake receipt must be rejected');
let result: any;
for (let slice = 0; slice < 5; slice++) {
  let prepared = await request(`/autopilot/${planId}/prepare`, { address: wallet.account.address });
  for (let step = 0; step < 2; step++) {
    const transaction = prepared.transaction as { to: Address; data: Hex; value: Hex };
    const hash = await wallet.sendTransaction({ chain: null, to: transaction.to, data: transaction.data, value: BigInt(transaction.value) });
    const receipt = await wallet.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');
    if (prepared.action === 'approve') {
      prepared = await request(`/autopilot/${planId}/prepare`, { address: wallet.account.address });
      assert.equal(prepared.action, 'swap');
      continue;
    }
    result = await request(`/autopilot/${planId}/confirm`, { transactionHash: hash });
    assert.equal(result.executedSlices, slice + 1);
    const duplicate = await request(`/autopilot/${planId}/confirm`, { transactionHash: hash });
    assert.equal(duplicate.executedSlices, slice + 1, 'Duplicate receipt cannot advance progress');
    break;
  }
}
assert.equal(result.status, 'completed');
assert.equal(result.remainingAmount, '0');
assert.equal(result.executions.length, 5);
console.log(JSON.stringify(result));
