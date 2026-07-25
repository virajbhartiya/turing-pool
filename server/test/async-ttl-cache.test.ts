import assert from 'node:assert/strict';
import test from 'node:test';

import { createAsyncTtlCache } from '../src/async-ttl-cache.js';

test('coalesces concurrent loads for the same liquidity-accounting key', async () => {
  let loadCount = 0;
  let releaseLoad!: (value: string) => void;
  const pendingLoad = new Promise<string>((resolve) => {
    releaseLoad = resolve;
  });
  const cache = createAsyncTtlCache({
    ttlMs: 15_000,
    load: async () => {
      loadCount += 1;
      return pendingLoad;
    },
  });

  const first = cache.get('vault:wallet');
  const second = cache.get('vault:wallet');
  const third = cache.get('vault:wallet');

  assert.equal(loadCount, 1, 'duplicate page requests must share the in-flight SQL load');
  releaseLoad('accounting');
  assert.deepEqual(await Promise.all([first, second, third]), [
    'accounting',
    'accounting',
    'accounting',
  ]);
});

test('does not retain a rejected in-flight load', async () => {
  let loadCount = 0;
  const cache = createAsyncTtlCache({
    ttlMs: 15_000,
    load: async () => {
      loadCount += 1;
      if (loadCount === 1) throw new Error('temporary indexer failure');
      return 'recovered';
    },
  });

  await assert.rejects(cache.get('vault:wallet'), /temporary indexer failure/);
  assert.equal(await cache.get('vault:wallet'), 'recovered');
  assert.equal(loadCount, 2);
});
