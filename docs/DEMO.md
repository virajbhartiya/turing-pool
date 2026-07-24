# Turing Pool — three-minute judge demo

## 75-second public-testnet proof

This is the fastest way to prove the product is executing rather than showing
mocked UI. It runs real transactions on Base Sepolia against the checked-in
deployment. The actors are encrypted Foundry keystores; no private key is in the
repository or printed to the terminal.

Terminal one:

```bash
RPC_URL=https://base-sepolia.drpc.org \
CHAIN_ID=84532 \
DEPLOYMENTS_PATH="$PWD/contracts/deployments/base-sepolia.json" \
PORT=4021 \
pnpm --filter @turing-pool/server start
```

The dashboard scans contract events from the deployment block, so its RPC must
support historical log reads. The executable agents use their own public
Base Sepolia RPC by default.

Open [http://localhost:4021](http://localhost:4021), then run in terminal two:

```bash
pnpm demo:sepolia
```

The command asserts all four claims and prints BaseScan transaction links:

1. An unauthenticated agent receives the AgentKit 402 challenge, selects the
   30 bps wide lane, and settles on-chain.
2. The human-backed agent signs the SIWE proof, resolves through the test
   AgentBook, selects the 8 bps tight lane, and settles from the same pool.
3. A second wallet with the same `humanId` asks for shared remaining quota plus
   one wei and is placed in the wide lane.
4. The custom SwapVM router executes `_humanGate` at opcode 34 and the receipt
   contains `HumanGated`.

Narrate it in one sentence per terminal beat, then return to the dashboard and
point at the quote difference, quota meter, tier counts, and decoded swap feed.
The truthful label is “public Base Sepolia with test Aqua and test AgentBook
contracts”; do not describe these test contracts as the canonical mainnet
deployments.

## Preflight

- `pnpm check`
- `pnpm e2e:fork`
- App, router, quota, Aqua, and AgentBook addresses are in the submission.
- `SUBGRAPH_URL` points to a synced, live Graph provider.
- Dashboard identifies local, fork, or live mode truthfully.
- Browser zoom is 100%; terminal font is readable from several metres away.
- Record a backup 2–4 minute video using the same sequence.

## Start

Terminal one:

```bash
pnpm demo:fork
```

Terminal two:

```bash
SUBGRAPH_URL=https://… pnpm demo:beats
```

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

### 2:10–2:45 — Graph-grounded autonomous repricing

Show the live Graph endpoint and sync status. The strategist reads indexed
tight/wide flow and Aqua balances, prints its rationale, docks the old
strategy, and ships a new one at 5bps.

### 2:45–3:00 — close the loop

Show the next human quote improving and finish with:

“World bounds identity risk, The Graph measures the flow, and Aqua makes the
new price executable without moving the LP’s funds into another pool.”

## Truthful fallback language

- Base fork: “deployed Aqua and AgentBook bytecode; demo registrations injected
  only into fork state.”
- Local: “local Aqua and mock AgentBook.”
- Never label a fork-injected identity as a production AgentBook registration.
- The Graph fallback is for local rehearsal only and must not be used for the
  judged Graph submission.
