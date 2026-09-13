import assert from 'node:assert/strict';
import test from 'node:test';

import { nextNonceForIdentityStatus } from '../src/world-identity.js';

test('an unregistered wallet still gets a usable identity status when the mock AgentBook has no nonce method', async () => {
  const nonce = await nextNonceForIdentityStatus(0n, async () => {
    throw new Error('execution reverted');
  });
  assert.equal(nonce, 0n);
});

test('a registered wallet still surfaces nonce read failures', async () => {
  await assert.rejects(
    nextNonceForIdentityStatus(123n, async () => {
      throw new Error('RPC unavailable');
    }),
    /RPC unavailable/,
  );
});
