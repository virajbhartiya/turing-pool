import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWebsiteTradeVenue } from '../src/trade-venue.js';

const PRIMARY_ROUTER = '0x0000000000000000000000000000000000000011' as const;
const VAULT_ROUTER = '0x0000000000000000000000000000000000000022' as const;
const DEMO_VAULT = '0x0000000000000000000000000000000000000033' as const;
const VAULT_FACTORY = '0x0000000000000000000000000000000000000044' as const;

test('website swaps use the active LP vault when permissionless liquidity is live', () => {
  assert.deepEqual(
    resolveWebsiteTradeVenue({
      primaryRouter: PRIMARY_ROUTER,
      vaultRouter: VAULT_ROUTER,
      activeVault: DEMO_VAULT,
      vaultFactory: VAULT_FACTORY,
    }),
    {
      kind: 'vault',
      router: VAULT_ROUTER,
      vault: DEMO_VAULT,
    },
  );
});

test('website swaps fall back to the primary order only without a configured vault', () => {
  assert.deepEqual(
    resolveWebsiteTradeVenue({
      primaryRouter: PRIMARY_ROUTER,
    }),
    {
      kind: 'primary',
      router: PRIMARY_ROUTER,
    },
  );
});
