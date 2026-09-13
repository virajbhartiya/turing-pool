# Verification record — 2026-09-05

## Follow-up: strategy feedback — 2026-09-07

The reported Generate → Activate/Re-evaluate issue was reproduced with a real
ReactDOM interaction test before implementation. The strategy API was returning
`active/wait` correctly: 208.5 bps execution dispersion exceeded the 150 bps limit.
The bug was missing action feedback near the button, not a failed transaction.

The position now displays failed checks with measured/allowed values, an explicit
no-transaction result, checking state and a numbered/time-stamped re-evaluation.
Preset prompts disclose their default guards. Errors and retry controls appear
in the position panel; requests time out instead of spinning indefinitely.
Transient recovery errors preserve the saved strategy rather than replacing it.

Interaction tests cover unchanged blocked results, newly passing checks requiring
a separate execution click, initial error/retry and a stalled-request timeout.
No risk limit was relaxed and no transaction was broadcast for this fix.

## Completed

- Removed scripted Run demo and replay controls; normal wallet actions remain.
- Production frontend/backend build and typechecking pass.
- Final `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm format:check` and
  `git diff --check` pass, including 57 server tests and 40 Solidity tests.
- Economics, frontend, server, agent and Solidity test suites pass; subgraph builds.
- Isolated Anvil E2E: 16/16 assertions, including five freshly mined strategy swaps,
  completed budget, exact receipt matching, fake-hash rejection and idempotency.
- Verified bytecode on World Chain 480 for all 12 configured addresses: AgentBook,
  Aqua, app, primary router/quota, vault factory/router/vault/quota, faucet and both
  tokens. No new deployment was necessary or performed.
- Live Nuthatch SQL+MCP is connected with matching registry provenance.
- Live API simulation passed for human/bot quotes in both directions, required
  approvals, an already-approved bot swap, LP deposit approval, redemption and
  faucet claim. These were eth_call checks, not broadcasts.
- The live API reports wallet execution enabled while server-operated trading
  remains disabled. RPC read batching has regressions proving sender-bound
  quotes preserve msg.sender.
- Strategy receipts are validated against chain events and prepared calldata;
  plans persist via an atomic, single-writer local ledger.
- Live plan creation, activation, approval preparation and pause rejection passed.
  The same paused plan was successfully recovered after an actual API restart.
- Desktop strategy/swap and mobile pool layouts were inspected; the mobile page
  fits its 390px viewport. Verify and Protocol screens load. No browser wallet
  is installed in the automated browser, so its signing flow remains untested live.

## Still requiring the user's wallet

No new World Chain transaction was broadcast during this verification pass:
the configured human and bot private-key fields are empty. Earlier indexed
receipts prove previous usage, not fresh execution of the new strategy flow.
Fresh swaps, deposit/redemption, faucet claim and strategy completion must be
signed from funded wallets before claiming full live readiness.

A new World ID registration needs the user's real World App proof. Browser
layout checks and contract simulation do not replace wallet signatures or that
proof. See the live runbook for the exact verification commands.

Public RPC rate limiting was observed under concurrent reads. Use a dedicated
RPC for a judged presentation. The app reports unavailable data and strategies
fail closed; local tests cannot guarantee RPC availability.

Nothing committed or pushed. This is test-token trading on mainnet, not a
testnet; native ETH gas has real cost.

## Submission UI pass — 2026-09-13

- Reworked the shared interface into an ivory/forest visual system with a custom
  wordmark, editorial strategy introduction, three-step guidance, clearer order
  entry, and consistent surfaces across strategies, swaps, liquidity, account,
  and activity. Preserved existing trading limits and wallet-signature controls.
- Explicit strategy generation now focuses and scrolls to its review. Confirmed
  in the live browser that changing 500 to 250 tUSD generates a 250 tUSD plan.
- Inspected desktop strategies, swap, account and liquidity. Exercised liquidity
  deposit/withdraw navigation. Mobile strategy content and all navigation fit
  390 pixels without horizontal overflow. No browser runtime errors observed.
- `pnpm check` passes: 9 economics, 18 frontend, 57 server, 8 agent and 40
  Solidity tests, subgraph build, typechecking and contract formatting. Final
  frontend typechecking and 18 tests pass after the last interface edits.
- `E2E_API_PORT=4022 E2E_RPC_PORT=8546 pnpm e2e` passes 16/16 assertions,
  including five newly mined Anvil strategy swaps, completion, receipt binding,
  and fake/replayed receipt rejection. These are isolated sandbox transactions.
- `node scripts/live-check.mjs --simulate` passes: 12 deployed contracts,
  Nuthatch SQL+MCP, human/standard quotes and transaction preparation in both
  directions, liquidity deposit/redemption and faucet simulation.
- `pnpm build` passes. Vercel build passes after producing current public assets;
  five selected local route/runtime/package checks pass. Fixed missing strategy,
  faucet and API rewrites with a failing regression first. Replaced a server
  `.at(-1)` read with indexed access for Vercel's ES2021 compilation target.
  Vercel's local builder can capture stale public asset names if inputs changed
  since the preceding build; run `pnpm build` before `vercel build`.
- No new mainnet transaction was broadcast. Browser wallet signing and real
  World App verification remain user-operated steps, not demonstrated by the
  sandbox or eth_call checks.
- Production host/HTTPS timed out; AWS authentication expired. The user explicitly
  deferred deployment. Nothing published, committed, or pushed in this pass.
- Live workspace left running at http://localhost:4030/#autopilot.

### Hero, navigation and flow follow-up

- Added a forest-green studio hero with direct build/swap actions and an account
  setup entry. Replaced decorative process text with working builder, review and
  market-check shortcuts; shortcuts move keyboard focus as well as scroll.
- Grouped the four trading destinations separately from Activity/Account. Added
  page/network context and fixed bottom navigation on phones. Removed obsolete
  header and hero style rules. Standard links expose destination URLs.
- Navigation now records browser history, allowing Back to return to the previous
  workspace. Verified mobile Swap → Back restores Strategies and its active link.
- Verified hero action focuses the budget input. No horizontal overflow at 320px
  or 390px. Frontend typechecking, 18 frontend tests and production build pass.
- Deployment remains deferred at the user's request.

### Continuous sandbox and complete browser execution — 2026-09-13

- Added `pnpm demo:market` with local-only Anvil chain 31337 on RPC 8546,
  frontend/API 4022, independent strategy storage, seeded liquidity and faucet.
  Two actors alternate small buy/sell transactions, bounded to 12 hours/5,000
  trades. Every submission checks loopback origins, Anvil client and chain ID.
  Confirmations and indexed receipts are recorded in `.data/demo-market/`.
- Reproduced and fixed local wallet chain switching with a failing test first:
  runtime chain 31337 now stays local instead of switching to World Chain 480.
  Tests also cover remote origin refusal and wallet-provider failures.
- Reproduced and fixed local receipt links with a failing test first. Links now
  open a local receipt viewer backed by RPC, with malformed/missing/wrong-chain
  handling and no mounting on mainnet.
- Browser EIP-1193 fixture signing passed swap, faucet claim, LP deposit and LP
  redemption on the first rehearsal. A high-dispersion strategy correctly waited
  without broadcasting. After a clean restart, account #3 claimed assets and
  completed a 20 tUSD strategy in two slices, with zero budget remaining.
  Latest strategy swap hash:
  `0xee8d7b3869d012a044d260cc754630cc48d74cc84bfdba1c389d946502d6c0a4`.
  This receipt exists only on the current local run; restarting resets it.
- Final `pnpm check`, `pnpm build`, and `git diff --check` pass. Isolated
  `E2E_API_PORT=4023 E2E_RPC_PORT=8548 pnpm e2e` passes 16/16. Live
  `node scripts/live-check.mjs --simulate` passes contracts, Nuthatch SQL/MCP,
  both quote directions for both actors, approval/swap, liquidity and faucet.
- Continuous activity remained running throughout browser transactions. Stop
  and restart were verified. See `docs/DEMO-MARKET.md` for presentation controls.
- These are local demo actors, not independent mainnet market makers. No fresh
  mainnet broadcast, real World App proof, or deployment was performed.
