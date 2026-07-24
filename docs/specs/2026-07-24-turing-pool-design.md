# Turing Pool — Design

**One-liner:** The first AMM that quotes tighter spreads for order flow provably backed by a unique human — Robinhood-style retail price improvement enforced by World ID proof-of-personhood instead of a broker.

**Event:** ETHGlobal Lisbon 2026. **Tracks:** World AgentKit ($8k), 1inch Aqua ($5k), The Graph Best AI Use Case ($3k).

## Problem

On-chain market makers cannot distinguish uninformed (retail) flow from toxic (arb-bot) flow, so every taker pays the worst-case spread. In TradFi, brokers segment retail flow and it receives price improvement (PFOF). World's AgentBook gives us the missing on-chain primitive: a public registry mapping agent wallets to a persistent, sybil-resistant `humanId` (a World ID nullifier). Human-backed flow with per-human volume caps has bounded adverse selection, so LPs can rationally quote it tighter.

## Architecture

```
┌────────────┐   x402 + AgentKit SIWE    ┌──────────────┐
│ Agent (CLI) │ ────────────────────────► │  Quote API    │──┐
└────────────┘                            │  (Hono, viem) │  │ eth_call quote
      │ swap tx                           └──────────────┘  │
      ▼                                                     ▼
┌──────────────────────────── Base (fork for demo) ─────────────────────┐
│  TuringPoolApp (AquaApp)  ──reads──►  AgentBook (World, 0xE1D1..)     │
│      │  pull/push                     HumanQuota (per-humanId caps)   │
│      ▼                                                                │
│  Aqua (1inch, 0x4999..)  — maker funds never leave maker wallet       │
│  TuringPoolRouter (SwapVM fork + _humanGate instruction)  [stretch+]  │
└───────────────────────────────────────────────────────────────────────┘
      ▲ events (Swapped w/ tier, humanId)
      │
┌─────────────┐    GraphQL     ┌──────────────────┐  dock+ship
│  Subgraph    │ ◄───────────── │ Strategist agent │ ───────────► Aqua
└─────────────┘                └──────────────────┘
```

## Components

### 1. Contracts (`contracts/`, Foundry)

- **`TuringPoolApp.sol`** — inherits 1inch `AquaApp`. Fork of `XYCSwap.sol` (constant-product) with:
  - `Strategy { maker, token0, token1, wideFeeBps, tightFeeBps, salt }` (immutable, hash = Aqua strategyHash).
  - `swapExactIn/quoteExactIn`: resolve `humanId = AGENT_BOOK.lookupHuman(taker)`; if `humanId != 0` and `HumanQuota.remaining(humanId) >= notional` → tight fee, else wide fee. Swap path records usage in HumanQuota; quote path is view-only.
  - Settlement: `AQUA.safeBalances` → compute out → `AQUA.pull(maker → taker)` → taker pays via `transferFrom` + `AQUA.push` (router-friendly, no callback contract needed) with `_safeCheckAquaPush` fallback for callback takers.
- **`HumanQuota.sol`** — `mapping(uint256 humanId => Usage)` daily notional caps (rolling UTC day), `recordUsage` restricted to registered pool apps, `remaining(humanId)` view. Cap shared across ALL wallets of one human (the sybil-resistance demo beat).
- **`_humanGate` SwapVM instruction + `TuringPoolRouter`** — custom opcode in a redeployed SwapVM router: reads AgentBook + HumanQuota, `jump`s to tight-fee program branch when human-backed and under cap. Identical logic in static (quote) and swap context except usage writes. Scores the 1inch "SwapVM used" bonus.
- **`MockAgentBook.sol`** — same `lookupHuman` ABI, settable, for unit tests and live-stage registration demo without Orb dependency. Production config points at the real AgentBook (Base `0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4`).

### 2. Quote API + demo agents (`server/`, `agent/`)

Hono server: x402-style 402 challenge carrying AgentKit extension → agent signs SIWE (CAIP-122) with its wallet → server verifies signature, resolves `lookupHuman` via viem, quotes both tiers from chain, returns the tier this taker would get + calldata. Demo clients: `bot.ts` (anonymous wallet) vs `human-agent.ts` (AgentBook-registered wallet).

### 3. Subgraph + Strategist (`subgraph/`, `agent/strategist.ts`)

Subgraph indexes `Swapped(strategyHash, taker, humanId, tier, tokenIn, amountIn, amountOut)` + Aqua `Shipped/Docked`. Entities: `Swap`, `TierStat` (per-tier volume, count), `Strategy`. Strategist agent: pulls per-tier flow + computes markouts (execution price vs price N blocks later), decides new `tightFeeBps`/cap (Claude API reasoning when `ANTHROPIC_API_KEY` set, deterministic heuristic otherwise), then `dock` + `ship` a re-parameterized strategy. The Graph is load-bearing: the agent's input data comes from the subgraph.

### 4. Dashboard (`web/`, Vite + React)

Side-by-side live quotes (bot vs human), quota meter per humanId, strategist action log, tier stats.

## Demo flow (scripted e2e = the judge demo)

1. Anvil fork of Base mainnet (real Aqua, real AgentBook bytecode). Deploy TuringPoolApp + HumanQuota; maker ships strategy (wide 30bps / tight 8bps).
2. Bot quotes+swaps → 30bps. Agent wallet registered in AgentBook (storage-write on fork; live registration via World App on stage) → quotes+swaps → 8bps. Same pool, same liquidity.
3. Same human, second wallet → same humanId → cap shared → over-cap swap falls back to wide tier. Sybil resistance shown on-chain.
4. Strategist reads subgraph stats → tightens tight-tier to 5bps → docks/re-ships → next human quote improves live.

## Decisions

- **AquaApp path first, SwapVM second:** raw AquaApp is the de-risked qualifying core; the `_humanGate` router is additive for scoring. Both use official Aqua (deployed instance on fork; vendored source in unit tests — redeployment explicitly allowed).
- **Fork demo:** 1inch explicitly allows local forks with on-chain transfers. The Graph needs live data → deploy contracts + tiny real position on Base mainnet before submission (out of scope for this build; subgraph is built/compiled and runs against anvil via graph-node docker if available, documented).
- **AgentKit beta ambiguity** (Base vs World Chain canonical, Orb requirement): contracts take AgentBook address as constructor arg; demo uses fork storage writes so the flow never blocks on Orb availability.

## Testing

- Foundry unit + integration tests per contract (fee tiering, quota rollover, sybil case, quote/swap consistency, Aqua settlement invariants).
- Fork test against real Base Aqua + AgentBook bytecode.
- Scripted e2e (`scripts/e2e.sh`): boots anvil fork, deploys, runs server + agents + strategist, asserts tier pricing, cap enforcement, and re-ship effect.
