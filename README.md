# 🧠 Turing Pool

**An AMM that prices bounded order-flow risk using proof of unique human backing.**

On-chain market makers can't tell retail flow from toxic arb-bot flow, so every taker pays the worst-case spread. TradFi solved this decades ago — brokers segment retail flow and it gets price improvement. Turing Pool brings that to DeFi with cryptography instead of brokers: World's **AgentBook** registry maps agent wallets to a persistent, sybil-resistant `humanId` (a World ID nullifier), and our pool reads it **on-chain, at quote time** to price personhood.

- **Human-backed agents** (within a per-human daily quota): dynamically priced tight fee
- **Anonymous bots**: the compensating activity-priced surcharge
- **Sybil wallets**: same human ⇒ same `humanId` ⇒ same shared quota. A fresh wallet buys you nothing.

The per-human cap is what makes this economically sound rather than a generic identity discount: bounded per-human volume ⇒ bounded adverse selection per human ⇒ LPs can rationally quote the tight tier. One human cannot reset that risk limit by creating another wallet. An on-chain revenue-neutral controller records the executed human/bot input notional after every mined fill and solves the next fee pair so the LP keeps a 19bps blended target. Trade count never enters the equation:

`human volume × tight fee + bot volume × wide fee ≈ total volume × 19bps`

Built at **ETHGlobal Lisbon 2026** for the World AgentKit, 1inch Aqua, and The Graph tracks.

## What's real

The executable demo is deployed on **World Chain mainnet (chain 480)**:

| Piece | Address |
|---|---|
| Aqua protocol deployment | `0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec` |
| Canonical World AgentBook | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` |
| TuringPoolApp | `0xA4CECe31cA7A7fb79f4A0ffCfd219d1BF92fD46b` |
| Adaptive SwapVM + `_humanGate` router | `0x0492E6325Aa7d26592444F0dAaF0AF9E6aA188C0` |
| Volume controller + shared HumanQuota | `0x0D0B45E2dC957EAe99AbdcEFC5B9D311DB63701d` |

The Aqua contract is the actual 1inch Aqua implementation compiled from the
project dependency and deployed on World Chain; it is not a mocked registry or
an HTML simulation. The router executes the actual SwapVM program shipped into
Aqua. Its first instruction is `_humanGate` at opcode 34, which reads the
canonical AgentBook during the transaction.

Two World-verified wallets resolve to the same canonical `humanId`; the bot
wallet resolves to zero. The deployment script refuses mainnet deployment
unless those invariants hold. Example public receipts:

- [1.0 tETH World-verified fill · 5 bps](https://worldscan.org/tx/0x3ac295603a541e1b7cb74e13f25175e25f04b152148e7114295ee719c7af8ce4)
- [Next anonymous fill · automatically repriced to 68 bps](https://worldscan.org/tx/0x59ce1c66e1d081c2a6488de13388407218b87594fb467ab3cbffe4f19498118f)

## Architecture

```
Agent (@worldcoin/agentkit client)          Anonymous bot
   │ 402 → SIWE sign → retry                     │ (wide lane)
   ▼                                             ▼
Quote API (Hono + viem) ──────────── eth_call quotes per taker
   │
   ▼ swaps hit the chain directly
┌──────────────────────────── World Chain ─────────────────────────────────┐
│                                                                          │
│  TuringPoolApp (custom Aqua app) ──reads──► AgentBook (World)            │
│      │ pull / push                          HumanQuota (cap + fee state)│
│      ▼                                                                   │
│  Aqua (1inch) — LP funds never leave the maker's wallet                  │
│                                                                          │
│  TuringPoolRouter = SwapVM + one new opcode: _humanGate (0x22)           │
│      continuation-style instruction: resolves taker's humanity + quota,  │
│      applies live fees, records executed notional, reprices the next fill │
│      (swap ctx only — quotes are static & honest by construction)        │
└──────────────────────────────────────────────────────────────────────────┘
   ▲ HumanGated + Swapped + fee events
   │
Nuthatch (The Graph) ◄── correlates live fills into SQL + MCP agent context.
HumanQuota           ◄── stores the authoritative notional mix and updates the
                         next schedule inside every SwapVM transaction.
```

Two independent on-chain implementations:
1. **`TuringPoolApp`** (`contracts/src/TuringPoolApp.sol`) — a raw Aqua app (fork of 1inch's reference `XYCSwap`) with tier resolution in `_resolveTier`.
2. **`TuringPoolRouter` + `_humanGate`** (`contracts/src/swapvm/`) — a redeployed SwapVM router whose instruction set is the standard `AquaOpcodes` **plus one new opcode**. Personhood is literally an instruction in 1inch's swap VM.

## Run it

```bash
# prerequisites: foundry, node 22+, pnpm
pnpm install && cd contracts && forge build && cd ..

# full local verification: typecheck, agent tests, subgraph build, Foundry, formatting
pnpm check

# fork tests vs REAL Base mainnet deployments (3 tests)
cd contracts && RUN_FORK_TESTS=1 forge test --match-contract Fork -vv && cd ..

# asserted end-to-end demos
pnpm e2e               # local Aqua + mock AgentBook
pnpm e2e:fork          # deployed Aqua + AgentBook bytecode on a Base fork
pnpm nuthatch:dev       # terminal 1: follow the live World contracts
pnpm demo:world         # terminal 3: trade → index → reprice proof

# optional local/fork rehearsals
pnpm demo:fork
SUBGRAPH_URL=https://… pnpm demo:beats
```

Copy `.env.example` for runtime configuration. `SUBGRAPH_URL` is optional for
analytics; the executable fee controller reads its authoritative state from
`HumanQuota` and does not depend on an off-chain indexer.

## Deployment readiness

The full mock-free stack is deployed on World Chain. Its checked-in deployment
manifest is `contracts/deployments/world-mainnet.json`. The private repository
is linked to Vercel; the Vite/React terminal and Hono backend share one origin.
`/state` reads World Chain, `/demo/quotes` performs live calls, and
`POST /demo/trade` signs a tightly capped transaction from a disposable human
or bot demo wallet. Signing keys remain server-side.

The live-chain production shape remains a single container: the Hono API serves
the dashboard at `/`, exposes `/health` for the host, and uses same-origin
dashboard requests. The checked-in [Render Blueprint](./render.yaml) waits for
CI before automatic deploys, and the [Dockerfile](./Dockerfile) runs the
compiled server as an unprivileged user.

Production deliberately refuses to start without `DEPLOYMENTS_JSON`, preventing
local or fork-only addresses from being published accidentally. See
[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for the World Chain inputs and
release checks.

## Track integration map

**World — AgentKit New Use Cases.** Human backing changes risk limits and execution terms in an adversarial market. The lower spread is justified by a sybil-resistant, per-human exposure cap; it is not an arbitrary identity benefit. AgentKit runs off-chain through the full 402→SIWE→verify loop and on-chain through `AgentBook.lookupHuman`. Integration feedback is in [FEEDBACK.md](./FEEDBACK.md).

**1inch — Build an Aqua App.** A custom dual-tier Aqua app plus a modified SwapVM router with `_humanGate` at opcode 34. The live receipts execute the custom router and verify its `HumanGated` event. Aqua owns the strategy namespace and virtual balances; SwapVM executes the fill while the maker retains asset ownership.

**The Graph — Nuthatch live activity layer.** The checked-in Nuthatch nest indexes the deployed router, quota, and Aqua contracts, correlates `HumanGated` with `Swapped`, and exposes the result through SQL and MCP. The older subgraph remains as an experiment. The safety-critical fee state stays on-chain; Nuthatch is not required to quote or settle.

## Repo layout

```
contracts/   Foundry: TuringPoolApp, HumanQuota, _humanGate + TuringPoolRouter
server/      AgentKit quote API plus the Vercel hosted-preview Function
agent/       bot.ts, human-agent.ts (SIWE loop + sybil demo), strategist.ts
nuthatch/    The Graph Nuthatch nest: World contracts, SQL views, semantics
subgraph/    Legacy Graph subgraph experiment
web/         Vite + React trading terminal (market, quote ticket, fee chart, ledger)
scripts/     e2e.sh — the whole demo, asserted, local or Base-fork mode
docs/        design and deployment runbooks
```

## The demo beats (≈3 min)

1. Bot asks for a quote → **402: prove human backing** → the current anonymous lane.
2. `_humanGate` executes inside SwapVM as opcode 34 and emits `HumanGated`.
3. AgentKit auto-signs SIWE → verified on-chain → the current tight lane. A second wallet attempts `remaining quota + 1` and is demoted to wide because it shares the same `humanId`.
4. Pick 0.1, 0.5, or 1.0 tETH and mine a fill. HumanQuota adds that exact executed notional and immediately solves the next tight/wide pair. A 1.0 tETH fill has 10× the influence of a 0.1 tETH fill while the LP blend stays ≈19bps.

The exact stage narration and preflight checklist are in [docs/DEMO.md](./docs/DEMO.md).
