# ETHOnline 2026 continuity boundary

This repository is a continuation of TuringSwap, built at ETHGlobal Lisbon
2026. Only work after the baseline below should be judged as ETHOnline work.

## Immutable baseline

- Baseline commit: `6acd9b52dde28cffa728133fbc0e345a4dbc5d4a`
- Prior project: [TuringSwap — ETHGlobal Lisbon 2026](https://ethglobal.com/showcase/turing-swap-ck2y6)
- Prior result: World AgentKit New Use Cases prize
- Continuity branch: `feature/turing-autopilot`

The repository currently contains no commit for the ETHOnline feature. The
working tree is intentionally left uncommitted at the owner's request. The
pre-existing edit to `web/src/components/TradingTerminal.tsx` was present before
the continuity branch and is not claimed as ETHOnline work.

## Pre-existing work

The following existed before ETHOnline:

- identity-priced tight and wide execution lanes;
- canonical World AgentBook lookup;
- AgentKit 402/SIWE quote verification;
- per-human volume quotas in `HumanQuota`;
- custom SwapVM `_humanGate` opcode 34;
- real Aqua settlement and self-custodial LP vaults;
- Nuthatch indexing of swaps, fee schedules and LP accounting;
- deterministic Nuthatch risk strategist;
- swap, pool, identity and protocol terminal views.

## New ETHOnline feature

Turing Autopilot is the new product layer:

1. Compile natural-language goals into a bounded conditional-DCA schema.
2. Resolve the connected execution wallet through AgentBook before treating the
   agent as human-backed.
3. Evaluate live searcher share, verified fee and execution-price dispersion.
4. Fail closed when Nuthatch is unavailable, stalled, stale or inconsistent.
5. Activate and pause the plan under direct human control.
6. Execute each slice through the existing real Aqua wallet path.
7. Reconcile confirmed receipts into the position and expose decision evidence.
8. Present the complete lifecycle in a new, judge-facing Autopilot workspace.

## Partner-track mapping

### World AgentKit Continuity

- Human-backed agent identity is visible in the Agent Passport.
- Live mode resolves the wallet through canonical AgentBook before attaching
  authority to a plan.
- AgentKit remains the protected service layer and World Sandbox is the remote
  test target.
- Feedback is recorded in `FEEDBACK-ETHONLINE.md`.

### The Graph AI Continuity

- Nuthatch is the load-bearing live market source.
- The agent performs decisions and automation rather than displaying raw rows.
- SQL provenance and the indexed block are shown beside the decision.
- The World Chain path does not fall back to direct events if Nuthatch fails.

### 1inch Aqua Continuity

- A single swap becomes a persistent, conditional, multi-slice position.
- Every slice uses the existing official Aqua/SwapVM settlement path.
- The UI demonstrates token movement and reconciles the mined receipt.
- Funds remain self-custodial and the human can stop future slices.

## Evidence to include in the submission

- Link this file from the showcase description.
- Show the baseline commit and this branch's eventual commit range.
- Focus the video on Autopilot, not on the pre-existing `_humanGate` internals.
- Include one successful World Chain receipt from an Autopilot slice.
- Show Nuthatch provenance and the AgentBook-backed passport on screen.
- Disclose any AI-assisted files and prompts used during the event.
