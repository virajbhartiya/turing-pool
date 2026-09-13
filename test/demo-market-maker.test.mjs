import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSandbox, loopbackUrl, nextTrade, positiveInteger } from '../scripts/demo-market-maker.mjs';

test('activity cannot target remote networks, credentials or redirects through URL components', () => {
  assert.equal(loopbackUrl('http://127.0.0.1:4022'), 'http://127.0.0.1:4022');
  for (const url of ['https://worldchain.org', 'http://127.0.0.1.evil.com', 'http://user:pass@localhost', 'http://localhost/rpc', 'http://localhost?upstream=mainnet']) assert.throws(() => loopbackUrl(url));
  const state = { runtime: { chainId: 31337 }, contracts: { mockAgentBook: true }, execution: { enabled: true, serverOperated: true } };
  assert.doesNotThrow(() => assertSandbox(state, '0x7a69', 'anvil/v1'));
  assert.throws(() => assertSandbox(state, '0x1e0', 'anvil/v1'));
  assert.throws(() => assertSandbox(state, '0x7a69', 'geth'));
  assert.throws(() => assertSandbox({ ...state, contracts: { mockAgentBook: false } }, '0x7a69', 'anvil/v1'));
});

test('alternates both lanes and spends only the settled output on the return leg', () => {
  assert.equal(nextTrade(0).lane, 'human');
  assert.deepEqual(nextTrade(1, { lane: 'human', amountOut: '4999' }), { lane: 'human', direction: 'tUSD-to-tETH', amountIn: '4999' });
  assert.equal(nextTrade(2).lane, 'bot');
  assert.equal(nextTrade(3, { lane: 'bot', amountOut: '3000' }).amountIn, '3000');
  assert.equal(nextTrade(4).lane, 'human');
  assert.throws(() => nextTrade(1));
  assert.throws(() => nextTrade(1, { lane: 'bot', amountOut: '4999' }));
  assert.throws(() => nextTrade(1, { lane: 'human', amountOut: '0' }));
});

test('run duration and cadence must remain bounded', () => {
  assert.equal(positiveInteger(undefined, 8000, 1000, 60000), 8000);
  for (const value of ['NaN', '0', '-1', '999999', '1.5']) assert.throws(() => positiveInteger(value, 8000, 1000, 60000));
});
