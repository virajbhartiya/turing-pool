# World AgentKit feedback — ETHOnline 2026 continuity build

This document covers the new Turing Autopilot integration. Lisbon-era findings
remain in `FEEDBACK.md`; they are not presented as new event work.

## AgentKit docs and integration flow

1. The maintained `createAgentkitClient` and `createAgentkitHooks` path is much
   clearer than assembling the 402 extension manually. A migration section for
   early AgentKit applications would help continuity teams identify which
   custom challenge and nonce code should be deleted.
2. The distinction between an AgentBook registration and authorization for a
   specific financial action remains important. AgentBook proves that a human
   backs the signer; applications must still define budgets, expiry and
   revocation. A first-party scoped-delegation example would make this boundary
   harder to miss.
3. The production-storage warning is good. A reference implementation backed
   by SQLite/Postgres would reduce the chance that teams copy
   `InMemoryAgentKitStorage` into a deployed rate-limit or discount flow.
4. Event callbacks such as `agent_verified`, `discount_applied` and
   `discount_exhausted` are useful for a visible agent passport. The docs could
   show a privacy-safe audit log that does not expose the full human identifier.

## Developer Portal navigation and debugging

1. AgentKit, AgentBook, World ID applications and Sandbox are conceptually one
   flow but appear as different products. A “human-backed agent” journey in the
   portal would reduce product-discovery time.
2. The portal should show the canonical AgentBook address and target network
   next to the application environment. This would prevent Base/World Chain
   confusion in continuity projects.
3. A request inspector containing action, resource URI, nonce state, signature
   type and AgentBook resolution result would be more actionable than a generic
   failed-verification message.

## Sandbox App test matrix

Remote Sandbox access is program-gated. The integration is designed for these
required states and records the expected application behavior:

| State | Expected Autopilot behavior |
|---|---|
| Registered human-backed agent | Passport becomes verified; plan may activate |
| Valid proof, unknown agent | Keep plan inactive; direct user to AgentBook registration |
| Cancelled proof | Preserve the draft without creating authority |
| Expired challenge | Request a fresh challenge; never reuse the old plan authorization |
| Replayed nonce | Reject and leave all execution controls disabled |
| AgentBook RPC unavailable | Display `Waiting safely`; do not infer identity locally |
| Nuthatch unavailable after verification | Identity remains visible, execution remains paused |

## Confusing, missing or hard to test

- Sandbox access is the critical external dependency for remote testing. A
  self-serve test-agent registration mode would make automated browser testing
  possible without weakening production AgentBook semantics.
- It is not obvious whether one Sandbox identity may safely register multiple
  agents to test shared human-level rate limits. That scenario is central to
  TuringSwap and should be documented explicitly.
- A documented way to reset a Sandbox agent registration would improve
  recovery and revocation testing.
- Clear error codes distinguishing invalid signature, reused nonce, unregistered
  agent and AgentBook RPC failure would materially improve end-user guidance.

## Requested follow-up validation

Before submission, run the table above with the event-provided Sandbox App and
append device/platform, timestamp and observed result. This document does not
claim that gated remote states were exercised without access.
