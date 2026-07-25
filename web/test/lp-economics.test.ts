import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveLpEconomics, type LpEconomicsState } from '../src/lib/lpEconomics';

const TOKEN = 10n ** 18n;
const token0 = '0x0000000000000000000000000000000000000001';
const token1 = '0x0000000000000000000000000000000000000002';

function stateFixture(): LpEconomicsState {
  return {
    pool: {
      strategyHash: '0xstrategy',
      token0,
      token1,
      balance0: '0',
      balance1: '0',
      tightFeeBps: '5',
      wideFeeBps: '33',
    },
    feeController: {
      tightFeeBps: 5,
      wideFeeBps: 33,
      targetFeeBps: 19,
      projectedWeightedFeeBps: 21.8,
      revenueDeltaBps: 2.8,
      humanShareBps: 4_000,
      tightVolume: (4n * TOKEN).toString(),
      wideVolume: (6n * TOKEN).toString(),
      status: 'already-balanced',
      canAdjust: true,
      formula: 'fixture',
      observedSwaps: 2,
      tightSwaps: 1,
      wideSwaps: 1,
      normalization: 'token0 notional',
      source: 'on-chain-volume-controller',
    },
    swaps: [
      {
        blockNumber: '1',
        taker: '0xhuman',
        humanId: '1',
        tight: true,
        tokenIn: token0,
        tokenOut: token1,
        amountIn: TOKEN.toString(),
        amountOut: (100n * TOKEN).toString(),
        feeBps: '5',
      },
      {
        blockNumber: '2',
        taker: '0xbot',
        humanId: '0',
        tight: false,
        tokenIn: token1,
        tokenOut: token0,
        amountIn: (200n * TOKEN).toString(),
        amountOut: (2n * TOKEN).toString(),
        feeBps: '30',
      },
    ],
  };
}

test('keeps opposite-direction input volume and implied fees in separate token buckets', () => {
  const model = deriveLpEconomics(stateFixture());

  assert.deepEqual(model.human.inputVolume, { token0: TOKEN, token1: 0n });
  assert.deepEqual(model.bot.inputVolume, { token0: 0n, token1: 200n * TOKEN });
  assert.deepEqual(model.total.impliedFees, {
    token0: 500_000_000_000_000n,
    token1: 600_000_000_000_000_000n,
  });
});

test('uses token0 input or reverse-fill token0 output for receipt-window notional', () => {
  const model = deriveLpEconomics(stateFixture());

  assert.equal(model.human.normalizedVolumeToken0, TOKEN);
  assert.equal(model.bot.normalizedVolumeToken0, 2n * TOKEN);
  assert.equal(model.total.normalizedVolumeToken0, 3n * TOKEN);
  assert.equal(model.realizedBlendedFeeBps, 21.666666);
  assert.equal(model.realizedFeeNotionalToken0, 6_500_000_000_000_000n);
});

test('projects the current controller schedule over its complete volume base', () => {
  const model = deriveLpEconomics(stateFixture(), {
    token0PriceInToken1: 100,
  });

  assert.equal(model.human.currentFeeBps, 5);
  assert.equal(model.bot.currentFeeBps, 33);
  assert.equal(model.controllerVolumeToken0, 10n * TOKEN);
  assert.equal(model.projectedBlendedFeeBps, 21.8);
  assert.equal(model.projectedFeeNotionalToken0, 21_800_000_000_000_000n);
  assert.equal(model.targetFeeNotionalToken0, 19_000_000_000_000_000n);
  assert.equal(model.projectedRevenueDeltaToken0, 2_800_000_000_000_000n);
  assert.equal(model.estimatedImpliedFeesToken1, 0.65);
  assert.equal(model.estimatedProjectedFeeToken1, 2.18);
});

test('reports no realized rate before any swaps and preserves input-fee rounding', () => {
  const fixture = stateFixture();
  fixture.swaps = [];
  const empty = deriveLpEconomics(fixture);
  assert.equal(empty.realizedBlendedFeeBps, null);

  fixture.swaps = [{
    blockNumber: '3',
    taker: '0xhuman',
    humanId: '1',
    tight: true,
    tokenIn: token0,
    tokenOut: token1,
    amountIn: '1',
    amountOut: '1',
    feeBps: '5',
  }];
  const rounded = deriveLpEconomics(fixture);
  assert.equal(rounded.total.impliedFees.token0, 1n);
  assert.equal(rounded.total.impliedFees.token1, 0n);
});
