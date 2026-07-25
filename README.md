# 🧠 Turing Pool

**An AMM that prices bounded order-flow risk using proof of unique human backing.**

On-chain market makers can't tell retail flow from toxic arb-bot flow, so every taker pays the worst-case spread. TradFi solved this decades ago — brokers segment retail flow and it gets price improvement. Turing Pool brings that to DeFi with cryptography instead of brokers: World's canonical **AgentBook** maps agent wallets to a persistent, sybil-resistant `humanId`; an authenticated mirror publishes those results onto Base, where SwapVM reads them atomically at quote and execution time.

- **Human-backed agents** (within a per-human daily quota): dynamically priced tight fee
- **Anonymous bots**: the compensating activity-priced surcharge
- **Sybil wallets**: same human ⇒ same `humanId` ⇒ same shared quota. A fresh wallet buys you nothing.

The per-human cap is what makes this economically sound rather than a generic identity discount: bounded per-human volume ⇒ bounded adverse selection per human ⇒ LPs can rationally quote the tight tier. One human cannot reset that risk limit by creating another wallet. An on-chain revenue-neutral controller records the executed human/bot input notional after every mined fill and solves the next fee pair so the LP keeps a 30bps blended target. Trade count never enters the equation:

`human volume × tight fee + bot volume × wide fee ≈ total volume × 30bps`

Built at **ETHGlobal Lisbon 2026** for the World AgentKit, 1inch Aqua, and The Graph tracks.

## What's real

Identity originates on **World Chain mainnet (chain 480)**. Trading, liquidity,
fees, quotas, vaults, and indexing run on **Base Sepolia (chain 84532)**:

| Piece | Address |
|---|---|
| Canonical World AgentBook · World Chain | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` |
| Authenticated AgentBook mirror · Base Sepolia | `0x70b9FE7Bd162B0014df1E1f435dB47765Db62455` |
| Aqua · Base Sepolia | `0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec` |
| Adaptive SwapVM + `_humanGate` router · Base Sepolia | `0x02467E79C0aa8458F4552d427771D72C30F5a484` |
| Volume controller + shared HumanQuota · Base Sepolia | `0x23253c0e2aF22D83859F9f0B61b2ed45ED3Bd63B` |
| HumanGate v2 vault router · Base Sepolia | `0x797670993d2E81266F8512C7438d5b3B1E9a49d6` |
| Permissionless vault factory · Base Sepolia | `0x6B5dA84980f3205F0a6aCc9469c7b8279575cd10` |
| Seeded public LP vault · Base Sepolia | `0x3f0B4a7d12D368Db1F56a39F907C20Eb04809160` |

The Aqua contract is the actual 1inch Aqua implementation compiled from the
project dependency and deployed on Base Sepolia. The router executes the actual
SwapVM program shipped into Aqua. Its first instruction is `_humanGate` at
opcode 34, which reads the Base mirror synchronously. The mirror records the
World source block and block hash and rejects stale relay updates.

Two World-verified wallets resolve to the same canonical `humanId`; the bot
wallet resolves to zero. The deployment script refuses mainnet deployment
unless those invariants hold. Example public receipts:

- [World-backed Base fill · tight lane](https://sepolia.basescan.org/tx/0x44458ed078c027d326edb5dd1bf0e6d1f74c4062b9be9f1a7720dc7ab58b264e)
- [Anonymous Base fill · wide lane](https://sepolia.basescan.org/tx/0xb8bd8b72e2c9b36d47b6855feb8abbcbda2174c9bb3fc14baceb6405d9f35547)

## Architecture

```
Agent (@worldcoin/agentkit client)          Anonymous bot
   │ 402 → SIWE sign → retry                     │ (wide lane)
   ▼                                             ▼
Quote API (Hono + viem) ──────────── eth_call quotes per taker
   │
   ▼ swaps hit the chain directly
World Chain: canonical AgentBook
   │ finalized lookup + source block/hash
   ▼
Base: WorldAgentBookMirror ──lookupHuman──► opcode 34
   │
   ▼
TuringPoolRouter = SwapVM + _humanGate
   │ applies live fee + records executed notional
   ▼
Aqua inventory + HumanQuota + permissionless LP vaults
   ▲ HumanGated + Swapped + fee events
   │
Nuthatch (The Graph) ◄── correlates live fills into SQL + MCP agent context.
HumanQuota           ◄── stores the authoritative notional mix and updates the
                         next schedule inside every SwapVM transaction.
```

Two independent on-chain implementations:
1. **`TuringPoolApp`** (`contracts/src/TuringPoolApp.sol`) — a raw Aqua app (fork of 1inch's reference `XYCSwap`) with tier resolution in `_resolveTier`.
2. **`TuringPoolRouter` + `_humanGate`** (`contracts/src/swapvm/`) — a redeployed SwapVM router whose instruction set is the standard `AquaOpcodes` **plus one new opcode**. Personhood is literally an instruction in 1inch's swap VM.

The deployment-ready vault extension adds permissionless, multi-LP pools
without mixing their economics. Every vault issues transferable shares, acts
as its own Aqua maker, and owns a dedicated `HumanQuota`; all vaults can share
one HumanGate v2 router because fee writes are authorized by exact order hash.
The connected-wallet terminal discovers those pools from the factory and
supports create, proportional deposits, transferable LP positions, pro-rata
withdrawals, and identity-priced SwapVM trades from MetaMask.
See [docs/VAULTS.md](./docs/VAULTS.md).

An unregistered account can choose **Connect wallet to World ID** inside the
trade ticket. The browser binds World's AgentKit proof to that wallet and its
canonical AgentBook nonce, submits it through World's registration relay, then
publishes the confirmed human ID to the Base mirror. The quote changes lanes
only after both on-chain stages complete; the app never handles the wallet's
private key.

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
pnpm nuthatch:dev       # terminal 1: follow Base execution + mirror events
pnpm demo:sepolia       # terminal 3: trade → index → reprice proof

# optional local/fork rehearsals
pnpm demo:fork
SUBGRAPH_URL=https://… pnpm demo:beats
```

Copy `.env.example` for runtime configuration. `SUBGRAPH_URL` is optional for
analytics; the executable fee controller reads its authoritative state from
`HumanQuota` and does not depend on an off-chain indexer.

## Deployment readiness

The cross-chain demo is deployed across World Chain and Base Sepolia. Its
checked-in execution manifest is
`contracts/deployments/base-sepolia-mirrored.json`. The private repository
is linked to Vercel; the Vite/React terminal and Hono backend share one origin.
`/state` reads Base, `/demo/quotes` performs live calls, and
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

**World — AgentKit New Use Cases.** Human backing changes risk limits and execution terms in an adversarial market. AgentKit performs the 402→SIWE→verify loop; the canonical World `lookupHuman` result is relayed with source-block provenance into the Base mirror consumed by SwapVM.

**1inch — Build an Aqua App.** A custom dual-tier Aqua app plus a modified SwapVM router with `_humanGate` at opcode 34. The live receipts execute the custom router and verify its `HumanGated` event. Aqua owns the strategy namespace and virtual balances; SwapVM executes the fill while the maker retains asset ownership.

**The Graph — Nuthatch live activity layer.** The checked-in Nuthatch nest indexes the deployed router, quota, and Aqua contracts, correlates `HumanGated` with `Swapped`, and exposes the result through SQL and MCP. The older subgraph remains as an experiment. The safety-critical fee state stays on-chain; Nuthatch is not required to quote or settle.

## Repo layout

```
contracts/   Foundry: app, quota, HumanGate router, LP vaults, and vault factory
server/      AgentKit quote API plus the Vercel hosted-preview Function
agent/       bot.ts, human-agent.ts (SIWE loop + sybil demo), strategist.ts
nuthatch/    The Graph Nuthatch nest: Base execution + mirror events, SQL views
subgraph/    Legacy Graph subgraph experiment
web/         Vite + React trading terminal (market, quote ticket, fee chart, ledger)
scripts/     e2e.sh — the whole demo, asserted, local or Base-fork mode
docs/        design and deployment runbooks
```

## The demo beats (≈3 min)

1. Bot asks for a quote → **402: prove human backing** → the current anonymous lane.
2. `_humanGate` executes inside SwapVM as opcode 34 and emits `HumanGated`.
3. AgentKit auto-signs SIWE → verified on-chain → the current tight lane. A second wallet attempts `remaining quota + 1` and is demoted to wide because it shares the same `humanId`.
4. Pick 0.1, 0.5, or 1.0 tETH and mine a fill. HumanQuota adds that exact executed notional and immediately solves the next tight/wide pair. A 1.0 tETH fill has 10× the influence of a 0.1 tETH fill while the LP blend stays ≈30bps.

The exact stage narration and preflight checklist are in [docs/DEMO.md](./docs/DEMO.md).
