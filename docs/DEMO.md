# Turing Pool — three-minute judge demo

## 75-second World Chain proof

This is the fastest way to prove the product is executing rather than showing
mocked UI. It runs real transactions through SwapVM and Aqua on World Chain
mainnet. The actor keys stay server-side; no private key is in the repository,
browser bundle, or terminal output.

Terminal one:

```bash
RPC_URL=https://worldchain-mainnet.g.alchemy.com/public \
CHAIN_ID=480 \
DEPLOYMENTS_PATH="$PWD/contracts/deployments/world-mainnet.json" \
DEMO_TRADES_ENABLED=1 \
DEMO_TRADE_ORIGIN=http://localhost:4021 \
DEMO_TRADE_MAX_AMOUNT_IN=1000000000000000000 \
BOT_PRIVATE_KEY=… \
HUMAN_AGENT_PRIVATE_KEY=… \
PORT=4021 \
pnpm --filter @turing-pool/server start
```

The dashboard scans contract events from the deployment block, so its RPC must
support historical log reads. Scans are automatically split into the public
RPC's 100-block maximum.

Open [http://localhost:4021](http://localhost:4021), then run in terminal two:

```bash
pnpm demo:world
```

The command asserts the execution claims and prints Worldscan transaction links:

1. The anonymous wallet resolves to zero in the canonical AgentBook,
   `_humanGate` selects the wide lane, and Aqua settles the trade.
2. The World-verified wallet resolves to its canonical `humanId`,
   `_humanGate` selects the tight lane, and the same Aqua order settles.
3. Both receipts contain `HumanGated` from opcode 34 and the SwapVM `Swapped`
   event; `/state` independently re-indexes both.
4. `HumanQuota` records each executed input amount on-chain and recomputes the
   next revenue-neutral fee pair. Quotes and failed transactions add no volume.

Narrate it in one sentence per terminal beat, then return to the dashboard and
point at the size selector, quote difference, notional mix, and decoded swap feed.
Truthful label: “World Chain mainnet; canonical AgentBook; Turing Pool-deployed
Aqua implementation; custom SwapVM router; maker-owned demo ERC-20 assets.”

## Preflight

- `pnpm check`
- `pnpm demo:world`
- App, router, quota, Aqua, and AgentBook addresses are in the submission.
- `/state.feeController.source` is `on-chain-volume-controller`.
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

### 2:45–3:00 — close the loop

Show the next human quote improving and finish with:

“World bounds identity risk, HumanQuota prices executed volume, and Aqua plus
SwapVM make the next revenue-neutral price executable without moving the LP’s
funds into another pool.”

## Truthful fallback language

- Base fork: “deployed Aqua and AgentBook bytecode; demo registrations injected
  only into fork state.”
- Local: “local Aqua and mock AgentBook.”
- Never label a fork-injected identity as a production AgentBook registration.
- If no Graph endpoint is configured, describe it as optional analytics rather
  than part of the authoritative execution path.
