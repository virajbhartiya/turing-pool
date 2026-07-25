# Turing Swap — demo brief, judge script, and 3-minute video plan

Live facts verified on World Chain mainnet (chain 480) at block 32,839,833:

| Thing | Value |
|---|---|
| Canonical World AgentBook (real, not ours) | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` |
| 1inch Aqua (World Chain) | `0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec` |
| Our SwapVM router, HumanGate v2 (opcode 34) | `0x0435F9650b70310e98fAEcADa042b3b4e4937Cad` |
| Vault factory | `0x83a665206D5cc52A0fDA7f308C5C1967d5159Fd0` |
| Active LP vault | `0xfe193d73161053E52B15527c9B508DB1357Ed072` |
| Verified human wallet → real World ID nullifier | `0x30b8…fBe5` → `1129021701…121168` |
| Unverified searcher wallet | `0xF365…1f30` → `0` |
| Live fee schedule right now | verified **19 bps**, unverified **50 bps** |
| LP revenue target / observed human share | **30 bps** / **64.85%** of volume |

Everything below is true of the deployed system, not a mock.

## The one-paragraph brief

Turing Swap is an on-chain market that **prices execution by counterparty risk instead of charging everyone the same fee**. Today every AMM quotes one fee to the whole world, and that fee has to be wide because liquidity providers are systematically picked off by latency-advantaged flow. Ordinary users end up subsidising that. Turing Swap reads World's on-chain AgentBook inside the swap itself: wallets that a unique verified human stands behind trade in a lower-fee lane, capped by a daily quota that is bound to the person — not the wallet — so extra wallets buy no extra capacity. Everything else trades in the risk-priced lane. An autonomous strategist agent watches realised per-lane volume through a Nuthatch indexer and re-prices both lanes on-chain to hold blended LP revenue at target. The result: verified humans currently pay 19 bps where unverified flow pays 50, and LPs still earn their 30 bps blended target.

## The 30-second spoken pitch

> "Every AMM charges one fee to everyone, and it has to be wide, because market makers can't tell who's on the other side. Turing Swap can. We read World's AgentBook registry from inside a custom 1inch SwapVM instruction, so the pool knows at quote time whether a unique human stands behind the wallet. Verified humans trade at 19 basis points; unverified flow pays 50. And because the quota is keyed to the World ID nullifier rather than the wallet, a second wallet inherits the same spent allowance — you can't sybil your way into the cheap lane. It's live on World Chain mainnet, against the real AgentBook and real 1inch Aqua, and an agent re-prices both lanes autonomously to keep LP revenue at target."

## Mental model (for answering anything)

Three layers, each a sponsor, each load-bearing:

1. **Identity — World.** AgentBook is a public on-chain mapping from wallet to `humanId`, an anonymous World ID nullifier that is *the same number for every wallet one human registers*. Because it's a plain mapping, a smart contract can read it mid-swap with one `staticcall`. That's the whole unlock. Off-chain, the quote API also runs the official AgentKit 402 → SIWE → verify loop.
2. **Execution — 1inch Aqua + SwapVM.** Aqua holds no funds: LPs keep tokens in their own wallet (here, in a vault contract), publish an immutable strategy, and Aqua settles wallet-to-wallet at fill time. SwapVM makes a strategy a *program* of opcodes. We added a new instruction — **opcode 34, `_humanGate`** — which resolves the taker's humanity and quota, then applies the correct fee to the rest of the program. Personhood is literally an instruction in 1inch's VM.
3. **Feedback — The Graph / Nuthatch.** Every fill emits its lane and `humanId`. The indexer exposes correlated per-lane trades; the strategist reads them, computes the fee pair that holds blended revenue at the LP target, and executes it on-chain by docking the old Aqua order and shipping a new one.

The economic argument in one line: **the per-human cap converts an unknowable question ("is this flow toxic?") into a bounded one ("how much can any single identity cost me per day?")** — which is why a lower fee for verified flow is underwriting rather than charity.

## Three-minute video script

Target 2:55. Record the terminal UI full-screen at 1280×800, with a block explorer in a second tab. Speak over live footage; no slides except the closing frame.

**0:00–0:20 — Hook (screen: the terminal, two lanes visible)**
> "This is a live market on World Chain mainnet. Same pool, same block, same trade size — and two different prices. This wallet pays 19 basis points. This one pays 50. The difference is that one of them can prove a unique human stands behind it."

**0:20–0:45 — Problem (screen: the fee controller panel)**
> "Every AMM today quotes a single fee to everyone, and it has to be wide, because liquidity providers can't tell ordinary flow from latency-advantaged flow that only shows up when the pool's price is stale. So everyone pays the worst-case spread. Traditional markets solved this by segmenting flow. On-chain, nobody could — there was no way to prove personhood inside a swap."

**0:45–1:30 — The demo, beats 1 and 2 (screen: quote race, then execute a real trade)**
> "World's AgentBook fixes that: a public on-chain mapping from wallet to an anonymous World ID nullifier. We read it from inside the swap. Here's an unverified wallet quoting — 50 basis points. Here's the verified wallet, same second, same size — 19. I'll execute it."
>
> *(execute, let the stepper run: identity → allowance → simulation → submission → settlement → receipt)*
>
> "That's a real transaction on World Chain. The receipt shows opcode 34 firing, the `HumanGated` event, and the nullifier — anonymous, but persistent."

**1:30–2:00 — Beat 3, the sybil defense (screen: quota meter + second wallet)**
> "Now the obvious attack: verify once, then run everything through the cheap lane. The quota is keyed to the *human*, not the wallet. This is the same person's second wallet — and it inherits the spent allowance, so it's quoted at the risk-priced fee. Extra wallets buy zero extra capacity. That bound is what makes the discount rational for LPs, not charity."

**2:00–2:30 — Beat 4, the autonomous strategist (screen: fee chart + strategy history)**
> "And the pool tunes itself. A strategist agent reads realised per-lane volume through our Nuthatch indexer, solves for the fee pair that keeps blended LP revenue at the 30 basis point target, then docks the Aqua order and ships a re-priced one — on-chain, by itself. Right now verified flow is 65% of volume, and the LP target is holding."

**2:30–2:55 — Proof and close (screen: protocol page with addresses, then explorer)**
> "This is deployed against the real canonical AgentBook and real 1inch Aqua on World Chain — not a fork, not a mock. Custom SwapVM instruction, permissionless LP vaults anyone can create and deposit into, and every fill auditable on-chain. Turing Swap: the market that prices who you are, and can't be fooled about it."

### Recording notes
- Rehearse once with the wallet already connected and funded, so no beat waits on a signature dialog you didn't expect.
- Keep the block explorer tab pre-loaded on the router address; cut to it for two seconds at 2:35.
- Say "verified human lane" and "risk-priced lane" — **not** "bots are bad." Searchers are 1inch's ecosystem; you're pricing risk, not moralising.
- Don't read the addresses aloud; show them.

## In-person judging (the 3-minute table version)

Order of operations at the table:

1. Open with the one-liner, then immediately show the two prices side by side. Don't explain before you show.
2. **Hand them your phone or ask them to scan** — if there's time, run the World App verification live so *they* become the verified human. This is the moment that wins the World track; it converts the claim into an experience.
3. Execute one real trade. Let the receipt land. Point at opcode 34 and the nullifier.
4. Show the second-wallet demotion. This is the intellectual punchline — pause here.
5. Show the strategist's re-pricing history and the LP target holding.
6. Close on the protocol page: real AgentBook, real Aqua, World Chain mainnet, 103 commits.

Per-sponsor emphasis if you know who you're talking to:
- **World:** personhood changes economic terms and rate limits; the quota is nullifier-bound; you ran both the on-chain read and the official AgentKit off-chain loop; `FEEDBACK.md` has six ranked, specific DevEx findings.
- **1inch:** you wrote a new SwapVM instruction and redeployed a router; you hit EIP-170 (their stock router has almost no headroom — one 48-byte-arg instruction pushed the fork over 24,576 bytes, fixed by dropping the Simulator mixin and re-tuning optimizer runs); quote/swap consistency is preserved because the instruction runs identically in static and swap context; vaults use dock+ship atomically on liquidity changes.
- **The Graph:** Nuthatch indexes correlated SwapVM fills with lane and nullifier; the strategist *acts* on that data on-chain, and the fee policy is bounded by what the indexer observed, not by a hardcoded schedule.

## Questions you will get, with answers

**"Isn't this just KYC / doesn't it break permissionlessness?"**
No identity is revealed — the on-chain value is a nullifier, an anonymous number. And nothing is gated: unverified flow trades freely, at a risk-priced fee. It's a discount for bounded risk, not a whitelist.

**"What stops someone renting a verified human's wallet?"**
Nothing stops it — and that's fine, because it's bounded. One human buys one daily quota. Renting an identity buys a known, capped amount of cheap-lane capacity, and the LP priced that in. Scaling the attack requires scaling *humans*, which is the one input you can't script.

**"Do LPs earn less on verified flow?"**
Per fill, yes — 19 instead of 50. In aggregate, no: the controller targets blended revenue, verified flow is the profitable kind to serve, and LPs can now widen the risk lane without driving away their best customers. That's the trade every retail-flow market maker in traditional finance takes happily.

**"Is this actually running, or is it a mock?"**
Real canonical AgentBook, real 1inch Aqua, World Chain mainnet, real World ID registration. The protocol page lists every address; the fee schedule you're looking at was set by an agent transaction you can open in the explorer.

**"What's next?"**
When World ships the Sybil score, make the fee a continuous function of it rather than a binary lane, and size per-human caps by score. Then let LP vaults set their own policy per pool.
