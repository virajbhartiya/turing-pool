# Turing Pool — three-minute judge demo

## 90-second three-system proof

This is the fastest way to prove the product is executing rather than showing
mocked UI. It runs real transactions through SwapVM and Aqua on Base Sepolia,
using identity mirrored from the canonical World Chain AgentBook. The dashboard
prepares calldata but the connected wallet signs
trades; the legacy replay script keeps its disposable actor keys server-side.
No private key is in the repository or browser bundle. Start Nuthatch before
the API so the indexer observes every new judge-demo receipt.

Terminal one:

```bash
pnpm nuthatch:dev
```

Terminal two:

```bash
RPC_URL=https://base-sepolia-rpc.publicnode.com \
CHAIN_ID=84532 \
DEPLOYMENTS_PATH="$PWD/contracts/deployments/base-sepolia-mirrored.json" \
DEMO_TRADES_ENABLED=1 \
DEMO_TRADE_ORIGIN=http://localhost:4021 \
DEMO_TRADE_MAX_AMOUNT_IN=1000000000000000000 \
BOT_PRIVATE_KEY=… \
HUMAN_AGENT_PRIVATE_KEY=… \
NUTHATCH_URL=http://127.0.0.1:8288 \
PORT=4021 \
pnpm --filter @turing-pool/server start
```

Nuthatch follows the Base mirror, routers, quotas, and Aqua contract, and
exposes correlated SwapVM trades through SQL and MCP.
The API falls back to narrow direct event scans if the indexer is unavailable;
settlement and fee enforcement never depend on the off-chain indexer.

Open [http://localhost:4021](http://localhost:4021), then run in terminal three:

```bash
pnpm demo:sepolia
```

## Connected-wallet demo

1. Add both funded demo accounts to a compatible browser wallet and connect them to the
   dashboard.
2. Open the dashboard in two tabs. Use the account selector to pin the
   World-backed address in one tab and the anonymous address in the other;
   the selection is stored per tab.
3. The wallet switches to the execution network automatically. The terminal
   calls the Base AgentBook mirror and assigns `TIGHT` or `WIDE`; there is no
   manual human/bot toggle.
4. Click buy or sell. If needed, the wallet first requests a token approval. A
   second prompt signs the actual SwapVM trade. The backend never signs for the
   connected account.
5. The terminal verifies `HumanGated` and `Swapped`, refreshes the LP book and
   controller, and links the mined BaseScan receipt.

The connected address must hold the deployed fixed-supply `tETH` or `tUSD`
demo asset selected as input, plus enough Base Sepolia ETH for gas. An arbitrary
new wallet account can connect and be classified, but cannot trade until it
receives the demo input asset.

The command asserts the execution claims and prints BaseScan transaction links:

1. The anonymous wallet resolves to zero in the Base mirror,
   `_humanGate` selects the wide lane, and Aqua settles the trade.
2. The World-backed wallet resolves to its canonical mirrored `humanId`,
   `_humanGate` selects the tight lane, and the same Aqua order settles.
3. Both receipts contain `HumanGated` from opcode 34 and the SwapVM `Swapped`
   event. Nuthatch correlates them by transaction and order hash, then exposes
   the live rows through `turing_trades`.
4. `HumanQuota` records each executed input amount on-chain and recomputes the
   next revenue-neutral fee pair. Quotes and failed transactions add no volume.

Narrate it in one sentence per terminal beat, then return to the dashboard and
point at the size selector, quote difference, notional mix, and decoded swap feed.
Truthful label: “Canonical World AgentBook identity mirrored with source-block
provenance; Aqua, SwapVM, quotas, vaults, and demo assets execute on Base
Sepolia.”

## Preflight

- `pnpm check`
- `pnpm demo:sepolia`
- App, router, quota, Aqua, and AgentBook addresses are in the submission.
- `/state.feeController.source` is `on-chain-volume-controller`.
- `/state.dataSources.activity.name` is `Nuthatch · SQL + MCP`, its lag is zero
  or near-zero, and its registry hash is visible.
- Dashboard identifies local, fork, or live mode truthfully.
- Browser zoom is 100%; terminal font is readable from several metres away.
- Record a backup 2–4 minute video using the same sequence.

## Narration

### 0:00–0:25 — the market problem

“AMMs cannot distinguish benign retail-like flow from toxic arbitrage, so they
quote everybody for the worst case. Turing Pool uses a World AgentBook
`humanId` and a shared daily quota to bound each human’s maximum exposure.
That bounded risk lets LPs rationally quote tighter.”

### 0:25–0:55 — same pool, different risk

Show simultaneous one-tETH quotes. The anonymous bot receives the wide lane.
The human-backed agent receives the tight lane from the same liquidity at the
same pool state. Point to the exact output difference and fee basis points.

### 0:55–1:20 — AgentKit and on-chain identity

Show the 402 challenge, SIWE signing, signature verification, and on-chain
`lookupHuman`. Keep the terminal event names visible; do not describe this as
login or a generic discount.

### 1:20–1:45 — personhood inside SwapVM

Show `_humanGate → XYC swap`, opcode 34, the router address, transaction hash,
and decoded `HumanGated` event. This is a real router execution, not just a
deployed unused contract.

### 1:45–2:10 — sybil cap

Wallet one consumes quota. Wallet two has a different address but the same
`humanId`; it attempts `remaining + 1` and is sent to the wide lane. Point to
the shared quota meter.

### 2:10–2:45 — executed-volume repricing

Select 1.0 tETH for the verified lane and execute it. Point to the on-chain
notional moving by exactly 1.0 tETH and to the next anonymous fee changing.
Then contrast it with a 0.1 tETH fill. Point to the controller equation:
`human share × tight fee + bot share × wide fee ≈ 19bps`. It lowers the
human-backed lane toward 5bps and raises or lowers the anonymous lane enough to
preserve the LP target. Counts remain visible, but never enter the formula.

### 2:45–3:00 — index the evidence and close the loop

Point to the three-system strip. Show the Nuthatch indexed block advancing past
the receipt, then open its SQL/admin surface if a judge wants to inspect it.
Show the next human quote improving and finish with:

“World bounds identity risk, Aqua plus SwapVM execute the price, and Nuthatch
makes the same receipts queryable for agents. HumanQuota keeps the safety-
critical fee state on-chain.”

## Truthful fallback language

- Base fork: “deployed Aqua and AgentBook bytecode; demo registrations injected
  only into fork state.”
- Local: “local Aqua and mock AgentBook.”
- Never label a fork-injected identity as a production AgentBook registration.
- Nuthatch is The Graph's self-hosted indexing path. Describe it as the live
  activity and agent-query layer, not the authoritative settlement or fee store.
