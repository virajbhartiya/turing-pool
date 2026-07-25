import assert from 'node:assert/strict';
import test from 'node:test';

import { publicVaultHistoryError } from '../src/vaults.js';

test('vault history failures never expose RPC credentials or request internals', () => {
  const upstream = new Error(
    'JSON is not a valid request object. '
      + 'URL: https://worldchain-mainnet.g.alchemy.com/v2/alch_example_secret '
      + 'Request body: {"method":"eth_getLogs"}',
  );

  const message = publicVaultHistoryError(upstream);

  assert.equal(message, 'Liquidity history is temporarily unavailable.');
  assert.doesNotMatch(message, /alch_|https?:|request body/i);
});
