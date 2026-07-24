# 🧠 Turing Pool

**An AMM that prices bounded order-flow risk using proof of unique human backing.**

On-chain market makers can't tell retail flow from toxic arb-bot flow, so every taker pays the worst-case spread. TradFi solved this decades ago — brokers segment retail flow and it gets price improvement. Turing Pool brings that to DeFi with cryptography instead of brokers: World's **AgentBook** registry maps agent wallets to a persistent, sybil-resistant `humanId` (a World ID nullifier), and our pool reads it **on-chain, at quote time** to price personhood.

- **Human-backed agents** (within a per-human daily quota): tight spread (e.g. 8bps → strategist-tuned to 5bps)
- **Anonymous bots**: wide spread (e.g. 30bps)
- **Sybil wallets**: same human ⇒ same `humanId` ⇒ same shared quota. A fresh wallet buys you nothing.

The per-human cap is what makes this economically sound rather than a generic identity discount: bounded per-human volume ⇒ bounded adverse selection per human ⇒ LPs can rationally quote the tight tier. One human cannot reset that risk limit by creating another wallet.

Built at **ETHGlobal Lisbon 2026** for the World AgentKit, 1inch Aqua, and The Graph tracks.

## What's real

Verified by `pnpm e2e:fork` on an **Anvil fork of Base mainnet**:

| Piece | Address |
|---|---|
| 1inch Aqua (real deployment) | `0x499943E74FB0cE105688beeE8Ef2ABec5D936d31` |
| World AgentBook (real deployment) | `0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4` |

The fork demo runs against the deployed Aqua and AgentBook bytecode. It injects demo registrations into the forked AgentBook storage (`lookupHuman` mapping at slot 4, validated against deployed bytecode in `TuringPoolFork.t.sol`); it does **not** claim those registrations exist in production state. Off-chain, the quote API runs the official `@worldcoin/agentkit` SDK end to end: 402 challenge → CAIP-122/SIWE signature → `parseAgentkitHeader`/`validateAgentkitMessage`/`verifyAgentkitSignature` → on-chain `lookupHuman`.

## Architecture

```
Agent (@worldcoin/agentkit client)          Anonymous bot
   │ 402 → SIWE sign → retry                     │ (wide lane)
   ▼                                             ▼
Quote API (Hono + viem) ──────────── eth_call quotes per taker
   │
   ▼ swaps hit the chain directly
┌───────────────────────── Base (fork for demo) ──────────────────────────┐
│                                                                          │
│  TuringPoolApp (custom Aqua app) ──reads──► AgentBook (World)            │
│      │ pull / push                          HumanQuota (per-humanId cap) │
│      ▼                                                                   │
│  Aqua (1inch) — LP funds never leave the maker's wallet                  │
│                                                                          │
│  TuringPoolRouter = SwapVM + one new opcode: _humanGate (0x22)           │
│      continuation-style instruction: resolves taker's humanity + quota,  │
│      applies tight/wide fee to the rest of the program, records usage    │
│      (swap ctx only — quotes are static & honest by construction)        │
└──────────────────────────────────────────────────────────────────────────┘
   ▲ Swapped events (tier + humanId)
   │
Subgraph (The Graph) ◄─── Strategist agent: measures per-tier flow toxicity
                          (markouts vs mid), decides new spreads (Claude API
                          or deterministic heuristic), then DOCKS + re-SHIPS
                          the Aqua strategy. Repricing is autonomous.
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

# asserted end-to-end demo
pnpm e2e               # local Aqua + mock AgentBook
pnpm e2e:fork          # deployed Aqua + AgentBook bytecode on a Base fork

# persistent judge demo
pnpm demo:fork         # terminal 1: chain + deploy + API + dashboard
SUBGRAPH_URL=https://… pnpm demo:beats  # terminal 2: narrated four-beat flow
```

Copy `.env.example` for runtime configuration. `SUBGRAPH_URL` is mandatory for
the judged strategist flow; the chain-log fallback is deliberately limited to
local chain 31337 and labels itself as non-judged.

## Deployment readiness

The full stack is deployed on **Base Sepolia** and can be served locally with
live RPC reads using `contracts/deployments/base-sepolia.json`. The deployment
uses public-testnet Aqua and AgentBook test contracts, while preserving the same
app, router, quota, pricing, and strategy lifecycle exercised by the fork demo.
Addresses and the server command are in
[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

The private repository is linked to Vercel. Its judge-facing preview serves the
dashboard from `public/` and a real Hono Function at `/health`, `/state`,
`/demo/quotes`, and `/quote`. Because the Turing Pool contracts are not deployed
on Base, this hosted mode is deliberately labeled as a deterministic,
non-executable snapshot; it never presents fork-only addresses as live state.

The live-chain production shape remains a single container: the Hono API serves
the dashboard at `/`, exposes `/health` for the host, and uses same-origin
dashboard requests. The checked-in [Render Blueprint](./render.yaml) waits for
CI before automatic deploys, and the [Dockerfile](./Dockerfile) runs the
compiled server as an unprivileged user.

Production deliberately refuses to start without `DEPLOYMENTS_JSON`, preventing
the local or Base-fork demo addresses from being published accidentally. Deploy
the contracts on Base, deploy the subgraph, then provide `RPC_URL`,
`SUBGRAPH_URL`, and the resulting deployment JSON through the host's secret
store. See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for the release order and
container command.

## Track integration map

**World — AgentKit New Use Cases.** Human backing changes risk limits and execution terms in an adversarial market. The lower spread is justified by a sybil-resistant, per-human exposure cap; it is not an arbitrary identity benefit. AgentKit runs off-chain through the full 402→SIWE→verify loop and on-chain through `AgentBook.lookupHuman`. Integration feedback is in [FEEDBACK.md](./FEEDBACK.md).

**1inch — Build an Aqua App.** A custom dual-tier Aqua app plus a modified SwapVM router with `_humanGate` at opcode 34. The E2E executes the custom router, verifies its `HumanGated` event, and executes token transfers on the fork. Settlement uses `ship/dock/pull/push`; the strategist demonstrates dock+re-ship as live re-pricing.

**The Graph — Best AI Use Case.** The strategist consumes live per-tier swaps and Aqua balances from the custom subgraph, reasons over execution edge, and acts on-chain by docking and shipping a re-priced strategy. Graph errors, missing strategies, and invalid balances fail loudly. Configure and deploy from `subgraph/` with `pnpm configure <app> <aqua> <block> base && pnpm deploy`; the judged demo requires the resulting `SUBGRAPH_URL`.

## Repo layout

```
contracts/   Foundry: TuringPoolApp, HumanQuota, _humanGate + TuringPoolRouter
server/      AgentKit quote API plus the Vercel hosted-preview Function
agent/       bot.ts, human-agent.ts (SIWE loop + sybil demo), strategist.ts
subgraph/    The Graph subgraph (schema, mappings, configure script)
public/      live dashboard (quote race, quota meter, tier flow, strategist log)
scripts/     e2e.sh — the whole demo, asserted, local or Base-fork mode
docs/        design and deployment runbooks
```

## The demo beats (≈3 min)

1. Bot asks for a quote → **402: prove human backing** → anonymous lane at 30bps.
2. `_humanGate` executes inside SwapVM as opcode 34 and emits `HumanGated`.
3. AgentKit auto-signs SIWE → verified on-chain → tight lane at 8bps. A second wallet attempts `remaining quota + 1` and is demoted to wide because it shares the same `humanId`.
4. The strategist reads live Graph data, explains its decision, then **docks + re-ships at 5bps**. The next human quote improves.

The exact stage narration and preflight checklist are in [docs/DEMO.md](./docs/DEMO.md).
