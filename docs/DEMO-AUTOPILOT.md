# Live presentation runbook

## Start

```sh
pnpm install
pnpm live
```

Open http://localhost:4030. The API is on 4021 and Nuthatch on 8288.
The launcher binds the API/UI to loopback and disables server-operated trades.
It does not load private keys. Ctrl-C stops only its child services; an indexer
that was already running is deliberately left alone.

The deployment is World Chain **mainnet, chain ID 480**. tETH and tUSD are test
assets; ETH for gas is real. All configured contracts already exist. Do not
redeploy them before a presentation. localhost:4030 needs the API and indexer.

For reliable availability set `RPC_URL` to your dedicated World Chain RPC and
`NUTHATCH_RPC_URL` to an endpoint supporting large log ranges. The public defaults
may throttle. Never put a secret RPC key in frontend code.

## Prepare your wallet

1. Connect a funded World Chain wallet. Keep a small ETH gas balance.
2. Under **Account**, claim tETH/tUSD if needed. Claims have a 24-hour cooldown.
3. Register through World ID/AgentBook if not registered. This requires your
   real World App proof; it cannot be fabricated.
4. Open **Swap** for manual trading. Autopilot is optional. Unverified wallets
   use wide pricing; verified wallets use tight pricing within quota.
5. Under **Liquidity**, deposit proportional assets (up to two exact-amount approvals)
   and inspect LP shares. Redeem returns your share of live inventory.

## A 90–180 second live story

- **0:00–0:20:** Show the change from Lisbon: identity-priced swaps now have a
  visible, evidence-gated strategy workspace. This is wallet-approved execution,
  not an unattended autonomous trading service.
- **0:20–0:45:** Generate a small two-slice intent: “Convert 0.4 tUSD to tETH in
  2 slices when bot activity is below 95%, fee under 35 bps and dispersion below
  300 bps.” Review current metrics and your limits; do not weaken a policy simply
  to force a trade through.
- **0:45–1:15:** Show identity, provenance and checks. Activate, execute slice 1,
  approve the token if requested, then sign the swap.
- **1:15–1:45:** Open the explorer receipt. Show reduced remaining budget, execute
  the final slice and show **Strategy complete**.
- **1:45–2:15:** Show verified/standard fees on Swap, LP ownership on Liquidity, or receipts on
  Activity. Pause prevents new preparation, not an already broadcast transaction.

The top navigation contains Overview, Strategies, Swap, Liquidity, Activity, and
Account, including on mobile. Strategies has a structured order ticket beside
market context and a separate progress panel. On mobile, the ticket comes first.
Enter budget, token direction, trade count and expiry; expand Execution limits
to adjust risk policy, or use Write instruction for natural-language entry.
Generation creates a reviewable draft, never a trade. Additional checks, swap
routing, and contract addresses remain expandable.

There is no Run demo button. Rehearse the same wallet flow you will use live.
Wallet timing and public-RPC delays are not guaranteed to fit the story.

## What Generate and Re-evaluate do

- **Generate verified strategy** compiles a draft; it does not submit a trade.
- **Activate autopilot** enables preparation under the displayed policy. It does
  not waive any guard or send a wallet transaction.
- **Re-evaluate live conditions** refreshes evidence. If a limit still fails,
  the strategy stays waiting and no wallet signature is requested.
- **Execute slice** requests wallet approval only after the checks pass. The
  backend checks the live conditions again before preparing the transaction.

For example, on 2026-09-07 the default strategy observed **208.5 bps dispersion**
against its **150 bps maximum**. Repeated evaluation correctly remained blocked.
Generating another identical strategy does not change that comparison. Wait for
the market condition to improve, or deliberately edit the risk limit in your
instruction and review the new draft. Limits must never be silently relaxed just
to make the presentation trade. Manual trading is separately available on Swap.

## Verification commands

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm e2e                               # stop the live API first, or use alternate ports
node scripts/live-check.mjs             # bytecode and indexer; no writes
node scripts/live-check.mjs --simulate  # live quotes/calls; no broadcasts
```

For explicitly authorized small live test-token transactions:

```sh
node scripts/live-check.mjs --execute
```

The last command requires `HUMAN_AGENT_PRIVATE_KEY` and `BOT_PRIVATE_KEY` in
`.env.production.local` (or a file selected by `LIVE_CHECK_ENV`). Addresses must
match the checked-in human/bot actors. Keep keys out of chat, browser code, git
and logs. It checks both directions for both actors, a faucet claim if eligible,
deposit/redemption and two strategy slices. It restricts targets, forbids native
value transfers and caps estimated gas cost per transaction. Hashes are logged
immediately: inspect any submitted hash before rerunning an interrupted test.
This is not a load test or continuous market maker.

## Recover honestly

- RPC unavailable: preserve the error, check service health and retry reads.
- Missing indexer or failed guards: show **Waiting safely**, not execution.
- Submitted hash but failed confirmation: use **Retry receipt verification**;
  never submit a duplicate swap just to fix the display.
- Refresh/restart: plans persist in `.data/autopilot-world.json`; use one API writer.
- Label a previous receipt as a previous transaction.
- Never present snapshot mode, eth_call simulation or Anvil mining as a new
  World Chain mainnet transaction.
