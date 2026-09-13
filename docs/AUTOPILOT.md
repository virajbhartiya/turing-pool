# Turing Autopilot architecture

## Product contract

Turing Autopilot converts a user goal into a constrained strategy. It never
generates Solidity, calldata or arbitrary code from natural language. The
parser may only fill a fixed `conditional-dca` schema:

```text
direction       tETH → tUSD | tUSD → tETH
total amount    positive, capped at 100,000 tokens
slices          1–20
searcher share  5–95%
verified fee    1–250 bps
price gap       5–2,000 bps
expiry          1–168 hours
```

Review the compiled amounts and limits before activation. Unknown prompt wording
uses template defaults; explicitly invalid directions, slice counts and zero-size
slices are rejected. This is a deterministic parser, not an unrestricted LLM.

## Runtime flow

```text
Intent
  │
  ▼
Bounded compiler ── creates plan + decision hash
  │
  ├── AgentBook lookup ── proves the connected wallet is human-backed
  │
  ├── Nuthatch SQL ────── live fills, fees, execution prices, provenance
  │
  ▼
Guard evaluation
  │ all pass
  ▼
Existing wallet preparation → SwapVM → Aqua settlement
  │
  ▼
HumanGated + Swapped receipt → plan slice reconciled
```

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/autopilot/templates` | Discover supported judge-facing presets |
| `POST` | `/autopilot/plan` | Compile an intent and bind current evidence |
| `GET` | `/autopilot/:id` | Read the persisted plan |
| `POST` | `/autopilot/:id/evaluate` | Refresh evidence and recompute guards |
| `POST` | `/autopilot/:id/activate` | Place the strategy under active human authority |
| `POST` | `/autopilot/:id/pause` | Block preparation of further slices |
| `POST` | `/autopilot/:id/prepare` | Recheck live policy and prepare an owner-signed approval or swap |
| `POST` | `/autopilot/:id/confirm` | Reconcile one verified mined execution receipt |

Plans, prepared requests and consumed receipts are atomically persisted in
`AUTOPILOT_STORE_PATH` (the live launcher uses `.data/autopilot-world.json`).
The browser remembers a plan ID per chain and connected wallet. No plan contains
a private key or World ID proof. Run exactly one API writer per store; multi-worker
hosting requires a transactional database and authenticated plan management.

Confirmation reads the actual receipt, SwapVM/Aqua events, transaction calldata,
sender, recipient and block timestamp. The amount, direction, fee, verified lane,
preparation block and execution window must match. Replays are idempotent within a
plan and rejected across plans; mutations are serialized to prevent double counting.
The last slice includes any integer-rounding remainder. Receipt verification can be
retried after a pause or indexer outage without submitting another transaction.

## Evidence policy

On World Chain, Nuthatch is mandatory. The API refuses to present direct event
fallback as live agent evidence. Nuthatch must report:

- `ready=true` and `stalled=false`;
- an indexed cursor no further than the connected tip;
- a matching chain ID and registry hash;
- SQL provenance within the final readiness snapshot;
- at least one indexed risk window.

Local Anvil tests may use a clearly labelled direct-event fallback because the
checked-in Nuthatch nest follows the deployed World Chain contracts, not fresh
ephemeral addresses.

## Safety properties

- No automatic execution when identity is missing.
- No automatic execution when evidence is missing or stale.
- No arbitrary model-generated transactions.
- Every amount and policy field is bounded.
- The normal wallet flow still simulates and asks for user approval.
- `Pause agent` prevents new preparation; it cannot cancel an already signed or broadcast transaction.
- The position records only confirmed transaction hashes.
- Wallet trading is independent of the disabled server-operated fixture trading endpoint.

## Current limitations

- The browser coordinates slice execution; there is no durable scheduler yet.
- Plan persistence is single-writer local storage, not a distributed database.
- The natural-language compiler is deterministic and template-constrained.
- Guards are server-side preparation conditions, not an on-chain strategy smart account.
  A wallet can submit transactions independently; this is not an unattended keeper.
- Preparation expires after five minutes or the plan expiry, whichever is earlier.
- Public RPCs can rate-limit. For a reliable presentation, configure a dedicated RPC.
- World Sandbox requires access through the event-provided program.

These limitations keep the demo inspectable and prevent an unreviewed model or
background worker from controlling funds.
