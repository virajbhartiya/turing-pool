# World AgentKit — Integration Feedback

Written while building Turing Pool at ETHGlobal Lisbon 2026. We integrated AgentKit twice: off-chain (the official `@worldcoin/agentkit@0.2.0` SDK gating a quote API, with Base signatures and canonical World Chain AgentBook verification) and on-chain (reading an authenticated AgentBook mirror from inside AMM contracts on Base). This file is the developer-feedback deliverable the World prize brief asks for.

## Time to integrate

- **Off-chain (SDK, 402 → SIWE → verify loop): ~2 hours**, of which ~40 minutes were spent on the two friction points below. The SDK's core loop (`createAgentkitClient` on the agent, `parseAgentkitHeader` → `validateAgentkitMessage` → `verifyAgentkitSignature` on the server) is genuinely well-factored — the client's automatic 402-detect/sign/retry worked on the first try.
- **On-chain (contract reads): ~1 hour** including verifying the storage layout against the deployed bytecode. `lookupHuman` being a plain public mapping is a gift: our SwapVM instruction and Aqua app read it with one `staticcall`, no oracle, no API, no per-request ZK verification.

## What worked well

1. **Registration-time proof + request-time signature is the right architecture.** Because the ZK proof is verified once at registration and the registry is an on-chain mapping, *smart contracts* can be relying parties — that's what made "an AMM that prices personhood" possible at all. Most identity systems only serve web2-style verifiers.
2. **The persistent `humanId` nullifier is the killer primitive.** Per-human (not per-wallet) quotas fall out of it in ~20 lines of Solidity (`HumanQuota.sol`). Our whole sybil-resistance story is one mapping keyed by it.
3. **The client SDK's event hooks** (`onEvent: agentkit_detected / signed / retry_completed`) made the demo narration free.
4. **No API key, no World-hosted verifier in the loop.** Fully self-serve with any RPC. This matters for hackathons and for censorship-resistance arguments.

## Friction found (ranked)

1. **SIWE domain expectation is undocumented and surprising.** `validateAgentkitMessage` derives the expected domain via `new URL(resourceUri).hostname` — hostname **without port** — while SIWE (EIP-4361) convention treats `domain` as the RFC 3986 *authority*, which includes the port. Serving on `localhost:4021` and setting `domain: "localhost:4021"` in the challenge fails with `Domain mismatch: expected "localhost", got "localhost:4021"`. Cost us a debugging cycle; a one-line doc note (or accepting both) would fix it.
2. **Serving the 402 challenge without a full x402 stack is undocumented.** `agentkitResourceServerExtension` assumes you're inside an x402 resource-server framework. Building a plain HTTP API, we had to read the client source to learn the expected 402 body shape (`{ extensions: { agentkit: { info, supportedChains, schema } } }`) and that `isAgentkitExtension` requires `info.domain/uri/version/nonce/issuedAt` + `supportedChains`. A "minimal manual server" snippet in the docs would save every non-x402 team an hour.
3. **Cross-chain lookup ergonomics need an explicit example.** The SDK correctly lets the agent sign on Base while `createAgentBookVerifier` resolves canonical identity on World Chain. An official example that then publishes the finalized result into a destination-chain mirror would help apps like ours, where SwapVM must read identity synchronously inside the same Base transaction.
4. **`AgentBook` storage layout is unspecified.** For fork-based testing we needed the `lookupHuman` mapping slot (it's slot 4). We derived it from the source and validated it against deployed bytecode in a fork test — fine for us, but a documented storage layout (or a `getSlot` helper/interface doc) would help anyone building fork tests or storage proofs.
5. **`InMemoryAgentKitStorage` nonce API is easy to wire wrong.** Nonce replay protection lives in `validateAgentkitMessage`'s `checkNonce` option, but recording the nonce is your job after full verification. The split is sensible but undocumented; an end-to-end server example showing `hasUsedNonce`/`recordNonce` placement would prevent silent replay holes.
6. **Registration requires World App + (apparently) Orb-level verification; the required `groupId` isn't documented.** For CI/fork demos we registered agents via storage writes; for the live registration beat we fall back to a Mock AgentBook when no Orb is reachable. A sandbox/testnet registration path with test credentials (Base Sepolia AgentBook + staging World App flow) would let hackathon teams demo the *real* registration on stage.

## Value assessment & whether we'd keep using it

Yes. The one-registry / one-nullifier design gave us a genuinely new market-microstructure primitive (bounded-adverse-selection pricing) that we could not build with any other identity system we know of — Gitcoin Passport-style scores aren't sybil-bound, and per-request ZK schemes can't be read cheaply from inside a swap hot path. The asks above are all documentation/DevEx, not architecture.

## Sybil-score interest (future)

When the Sybil score ships: we'd use it as a *continuous* input to spread width (score-weighted fee curve instead of binary tight/wide) and to size per-human caps. Priced (not gated) risk is exactly what an AMM wants.
