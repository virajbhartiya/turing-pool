import assert from 'node:assert/strict';
import test from 'node:test';

import { activityFeePolicy } from '../src/fee-policy.js';

const TOKEN0 = '0x0000000000000000000000000000000000000001';
const TOKEN1 = '0x0000000000000000000000000000000000000002';

test('activity policy normalizes both directions and preserves the target blended fee', () => {
  const policy = activityFeePolicy(
    [
      {
        tight: true,
        tokenIn: TOKEN0,
        amountIn: '100',
        amountOut: '400000',
      },
      {
        tight: true,
        tokenIn: TOKEN1,
        amountIn: '400000',
        amountOut: '100',
      },
      {
        tight: false,
        tokenIn: TOKEN0,
        amountIn: '100',
        amountOut: '400000',
      },
    ],
    {
      token0: TOKEN0,
      tightFeeBps: 8,
      wideFeeBps: 30,
    },
  );

  assert.equal(policy.tightVolume, '200');
  assert.equal(policy.wideVolume, '100');
  assert.equal(policy.tightFeeBps, 5);
  assert.equal(policy.wideFeeBps, 47);
  assert.equal(policy.projectedWeightedFeeBps, 19);
  assert.equal(policy.revenueDeltaBps, 0);
  assert.equal(policy.observedSwaps, 3);
});
