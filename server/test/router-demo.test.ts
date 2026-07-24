import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFeeSchedule,
  buildTakerTraits,
  parseHumanGateProgram,
  resolveHumanGateTier,
} from '../src/router-demo.js';

const BASE_SEPOLIA_PROGRAM =
  '0x2230265f638eb93314ad0e0471e3cc2c97565e75d6e6a4cece31ca7a7fb79f4a0ffcfd219d1bf92fd46b002dc6c0000c3500110014080000000000000001';

test('the shipped SwapVM program starts with the real _humanGate opcode and identity contracts', () => {
  assert.deepEqual(parseHumanGateProgram(BASE_SEPOLIA_PROGRAM), {
    opcode: 34,
    agentBook: '0x265f638eb93314ad0e0471e3cc2c97565e75d6e6',
    quota: '0xa4cece31ca7a7fb79f4a0ffcfd219d1bf92fd46b',
    wideFeeBps: 30,
    tightFeeBps: 8,
  });
});

test('taker traits encode exact-in Aqua settlement and an optional minimum output', () => {
  assert.equal(buildTakerTraits(), `0x${'00'.repeat(20)}0041`);
  const withThreshold = buildTakerTraits(42n);
  assert.equal(withThreshold.slice(2, 42), '0020'.repeat(10));
  assert.equal(withThreshold.slice(42, 46), '0041');
  assert.equal(BigInt(`0x${withThreshold.slice(46)}`), 42n);
});

test('program parsing rejects anything that is not opcode 34 with 48-byte arguments', () => {
  assert.throws(() => parseHumanGateProgram('0x2130' as `0x${string}`), /too short|opcode/);
  assert.throws(
    () => parseHumanGateProgram(`0x2130${'00'.repeat(48)}` as `0x${string}`),
    /expected _humanGate opcode 34/,
  );
});

test('terminal tier labels mirror _humanGate identity and quota resolution', () => {
  const program = parseHumanGateProgram(BASE_SEPOLIA_PROGRAM);

  assert.deepEqual(resolveHumanGateTier(program, 0n, undefined, 1n), {
    tight: false,
    feeBps: 30n,
  });
  assert.deepEqual(resolveHumanGateTier(program, 123n, 10n, 10n), {
    tight: true,
    feeBps: 8n,
  });
  assert.deepEqual(resolveHumanGateTier(program, 123n, 9n, 10n), {
    tight: false,
    feeBps: 30n,
  });
  assert.throws(
    () => resolveHumanGateTier(program, 123n, undefined, 10n),
    /quota remaining is required/,
  );
});

test('the live on-chain fee schedule overrides immutable order fallback fees', () => {
  const program = parseHumanGateProgram(BASE_SEPOLIA_PROGRAM);
  const effective = applyFeeSchedule(program, {
    tightFeeBps: 5n,
    wideFeeBps: 47n,
    targetFeeBps: 19n,
    humanShareBps: 6_666n,
    tightVolume: 200n,
    wideVolume: 100n,
  });

  assert.equal(effective.tightFeeBps, 5);
  assert.equal(effective.wideFeeBps, 47);
  assert.deepEqual(resolveHumanGateTier(effective, 0n, undefined, 100n), {
    tight: false,
    feeBps: 47n,
  });
});
