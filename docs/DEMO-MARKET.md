# Continuous local demo

Open http://127.0.0.1:4022/#autopilot on this computer. The sandbox is running
with two automated actors taking alternating buy/sell trades against seeded
liquidity. These are actual Anvil transactions using local test funds and mock
identity, clearly labelled in the UI. They are not World Chain activity or
independent customer demand. The runner does not manage spreads or rebalance LP
positions; it supplies continuous demo order flow to the seeded market.

## Controls

```sh
pnpm demo:market         # start the whole isolated environment
pnpm demo:market:status  # confirmed count, most recent receipt, errors
pnpm demo:market:stop    # stop activity AND its local API and chain
```

Default cadence is an eight-second pause after each confirmed transaction
(roughly 8–12 seconds per trade). The run ends after 12 hours or 5,000 trades,
whichever comes first. Keep the computer awake and the launcher running.
Logs and status live in `.data/demo-market/`. The runner stops on failed or
uncertain submissions rather than blindly retrying. Read `activity.log` if its
status contains an error.

Starting again deploys a fresh chain and archives the old strategy ledger.
Old transaction links and wallet nonce caches belong to the previous chain;
clear the wallet's local activity/nonce cache after a restart. Duplicate starts
and occupied ports are rejected. Stop/start was exercised successfully.

Requires the existing pnpm dependencies and Foundry (`anvil`, `forge`, `cast`).
The launcher builds the frontend and seeds the market, a separate LP vault,
and faucet. It uses ports 4022 and 8546; the separate live workspace on 4030
is untouched. Public RPCs and non-Anvil chains are rejected by the activity
runner, and every submission rechecks local chain identity.

## Wallet and presentation flow

Use a dedicated local demo wallet with Anvil network:

- RPC: `http://127.0.0.1:8546`
- Chain ID: `31337`
- Currency: `ETH` (local fixture balance)
- Manual actor: standard Anvil account #3,
  `0x90F79bf6EB2c4f870365E785982E1f101E93b906`.
  Obtain its public development key from Anvil's standard account list; these
  fixtures must never hold real assets. This account has mock human registration.
- Background activity owns accounts #1 and #2. Use #3 for manual interaction
  to keep wallet nonces separate.

1. Open Account and connect the local wallet. Claim test assets to get tUSD.
   The faucet has a one-day cooldown. Account #3 already claimed in the current
   verification run and still has its test funds.
2. Show Strategies and the updating market checks/activity. Build a **20 tUSD,
   two-trade** strategy. Generate, activate, then sign each execution. Activation
   only checks conditions; each slice still requires wallet approval.
3. Open a strategy receipt to show the mined local transaction.
4. Swap a small amount (for example 0.001 tETH), then show the receipt and Activity.
5. In Liquidity, add liquidity, inspect LP shares, and withdraw a portion.

Large one-sided swaps can move price dispersion beyond the strategy guard.
A waiting strategy is an expected result: show the measured check and re-evaluate
when conditions recover. Limits remain enforced. The liquidity vault is a
separate venue from the primary market used by the continuous activity loop.

## Verified

Browser signing was exercised with an EIP-1193 adapter restricted to this local
origin, local chain, and one unlocked Anvil account. It is a test harness, not a
replacement for a real wallet extension. Confirmed swap, faucet, LP deposit,
LP redemption, and a complete two-slice strategy all passed. The isolated E2E
suite passed 16/16 checks, including five mined strategy swaps and rejection of
fake/replayed receipts. `pnpm check`, production build, and whitespace checks
passed. Local receipt pages read actual RPC receipts.

World Chain contract and transaction simulations passed separately; no fresh
mainnet transactions were broadcast. Real World App registration and mainnet
wallet signing remain user-operated. Deployment is deferred.
