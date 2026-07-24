# 🧠 Turing Pool

**The first AMM that quotes tighter spreads for order flow provably backed by a unique human.**

On-chain market makers can't tell retail flow from toxic arb-bot flow, so every taker pays the worst-case spread. TradFi solved this decades ago — brokers segment retail flow and it gets price improvement. Turing Pool brings that to DeFi with cryptography instead of brokers: World's **AgentBook** registry maps agent wallets to a persistent, sybil-resistant `humanId` (a World ID nullifier), and our pool reads it **on-chain, at quote time** to price personhood.

- **Human-backed agents** (within a per-human daily quota): tight spread (e.g. 8bps → strategist-tuned to 5bps)
- **Anonymous bots**: wide spread (e.g. 30bps)
- **Sybil wallets**: same human ⇒ same `humanId` ⇒ same shared quota. A fresh wallet buys you nothing.

The per-human cap is what makes this economically sound, not just a gimmick: bounded per-human volume ⇒ bounded adverse selection per human ⇒ LPs can rationally quote the tight tier. One human can't launder an arb desk's flow through the cheap lane.

Built at **ETHGlobal Lisbon 2026** for the World AgentKit, 1inch Aqua, and The Graph tracks.

## What's real

Verified by `./scripts/e2e.sh fork` (8/8 assertions) on an **anvil fork of Base mainnet**:

| Piece | Address |
|---|---|
| 1inch Aqua (real deployment) | `0x499943E74FB0cE105688beeE8Ef2ABec5D936d31` |
| World AgentBook (real deployment) | `0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4` |

The demo registers agents into the **real AgentBook's storage** (`lookupHuman` mapping @ slot 4, layout validated against the deployed bytecode in `TuringPoolFork.t.sol`) and ships strategies on the **real Aqua**. Off-chain, the quote API runs the **official `@worldcoin/agentkit` SDK** end to end: 402 challenge → CAIP-122/SIWE signature → `parseAgentkitHeader`/`validateAgentkitMessage`/`verifyAgentkitSignature` → on-chain `lookupHuman`.

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

# unit + integration tests (24 tests: tiering, sybil caps, quote/swap parity, settlement)
cd contracts && forge test

# fork tests vs REAL Base mainnet deployments (3 tests)
RUN_FORK_TESTS=1 forge test --match-contract Fork -vv

# full end-to-end demo (anvil + deploy + API + bot + human agent + sybil + strategist)
./scripts/e2e.sh          # local mode
./scripts/e2e.sh fork     # against real Aqua + real AgentBook on a Base fork

# live demo (each in its own terminal)
anvil --port 8545                                          # or --fork-url base
cd contracts && forge script script/DeployDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cd server && pnpm start                                    # quote API :4021
cd web && pnpm start                                       # dashboard :4030
cd agent && pnpm bot && pnpm human && pnpm strategist      # the demo script
```

## Track integration map

**World — AgentKit New Use Cases.** Human-backing changes *economic terms* in an adversarial market: access (tight tier), rate limits (per-human daily quota), pricing (spread). Uses AgentKit both off-chain (official SDK, full 402→SIWE→verify loop in `server/src/index.ts`) and on-chain (`AgentBook.lookupHuman` read inside the AMM at `contracts/src/TuringPoolApp.sol:126` and `contracts/src/swapvm/HumanGate.sol`). Sybil resistance via the shared nullifier is the core trust model, not a login. Integration feedback in [FEEDBACK.md](./FEEDBACK.md).

**1inch — Build an Aqua App.** A custom Aqua app implementing a sophisticated position (dual-tier identity-priced AMM) *plus* a modified SwapVM router with a new instruction (`_humanGate`, opcode 34) — redeployment explicitly allowed by the track. On-chain transfers demoed on a fork (allowed). Settlement uses `ship/dock/pull/push` with LP funds never leaving the maker wallet; the strategist demonstrates dock+re-ship as live re-pricing. Proper commit history throughout.

**The Graph — Best AI Use Case.** The Strategist agent's input data is per-tier flow analytics (`subgraph/` — `Strategy`, `Swap`, `TierStat`, `Human` entities; `graph build` green). It *reasons* over markout/toxicity stats and *acts* on-chain (dock + ship). `SUBGRAPH_URL` switches it from the API fallback to a deployed subgraph endpoint; deploy with `pnpm configure <app> <aqua> <block> base && graph deploy` from `subgraph/`.

## Repo layout

```
contracts/   Foundry: TuringPoolApp, HumanQuota, _humanGate + TuringPoolRouter, 27 tests
server/      AgentKit-gated quote API (official @worldcoin/agentkit SDK)
agent/       bot.ts, human-agent.ts (SIWE loop + sybil demo), strategist.ts
subgraph/    The Graph subgraph (schema, mappings, configure script)
web/         live dashboard (quote race, quota meter, tier flow, strategist log)
scripts/     e2e.sh — the whole demo, asserted, local or Base-fork mode
docs/        design doc
```

## The demo beats (≈3 min)

1. Bot asks for a quote → **402: prove you're human-backed** → falls back to anonymous lane → 30bps.
2. Human agent's AgentKit client auto-signs SIWE → verified on-chain → **8bps, +22bps price improvement**, same pool, same second.
3. Human's *second wallet* tries to reuse the cheap lane past the cap → same `humanId` → **demoted to wide. Sybil defeated.**
4. Strategist agent reads the subgraph, sees human flow is benign → **docks + re-ships at 5bps** → next human quote is better. The pool learns to trust humans, autonomously.
