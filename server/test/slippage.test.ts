import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { minimumOutput, parseSlippageBps } from '../src/slippage.js';

test('selected slippage determines the on-chain minimum output with integer rounding', () => {
  assert.equal(minimumOutput(10_000n, 10), 9_990n);
  assert.equal(minimumOutput(10_000n, 50), 9_950n);
  assert.equal(minimumOutput(10_000n, 100), 9_900n);
  assert.equal(minimumOutput(123_456n, 50), 122_838n);
  assert.equal(minimumOutput(10_000n, 0), 10_000n);
  assert.equal(parseSlippageBps(undefined), 50);
});

test('rejects malformed or unsafe slippage instead of silently using another tolerance', () => {
  for (const value of [null, true, '50', '', -1, 0.1, NaN, Infinity, 10_000, {}, []]) {
    assert.throws(() => parseSlippageBps(value), /slippageBps/);
  }
  assert.throws(() => minimumOutput(-1n, 50), /amount/);
});

test('wallet API and both execution venues wire the validated tolerance into swap calldata', async () => {
  const sources = await Promise.all(['app', 'trade-venue', 'router-demo', 'vaults'].map((name) => readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')));
  assert.match(sources[0], /prepareWebsiteWalletTrade\(body\.address, amountIn, direction, parseSlippageBps\(body\.slippageBps\)\)/);
  assert.match(sources[1], /prepareConnectedWalletTrade\(walletInput, amountIn, direction, slippageBps\)/);
  assert.match(sources[1], /prepareVaultTrade\([\s\S]*?await vaultDirection\(venue\.vault, direction\),\s*slippageBps,/);
  assert.match(sources[2], /minimumAmountOut = minimumOutput\(BigInt\(quote\.amountOut\), slippageBps\)/);
  assert.match(sources[3], /minimumAmountOut = minimumOutput\(BigInt\(quote\.amountOut\), selectedSlippageBps\)/);
  for (const source of sources.slice(2)) assert.match(source, /buildTakerTraits\(minimumAmountOut\)/);
});
