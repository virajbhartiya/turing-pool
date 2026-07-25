# Turing Pool — UI/UX design prompt

Use everything below the line as the source of truth for the design agent.

---

You are designing the complete interface for **Turing Pool**, a live DeFi product being demoed to judges and sponsor engineers at ETHGlobal Lisbon. The backend, contracts, and data are already built and working — I need the interface designed properly: information architecture, visual system, component specs, states, and motion. Design it so a stranger understands the product in 20 seconds and a skeptical engineer trusts it in two minutes.

## 1. What the product is

**Turing Pool is an automated market maker (a decentralized exchange pool) that charges a lower trading fee to traders who can cryptographically prove they are backed by a unique real human, and a higher fee to anonymous bots.**

Why that matters, in plain terms:

- Every AMM today charges one fee to everyone. That fee has to be high because liquidity providers (LPs) are constantly picked off by arbitrage bots that trade only when the pool's price is stale. So normal humans overpay to subsidize the damage bots do.
- Turing Pool reads World's on-chain **AgentBook** registry mid-trade. That registry maps a wallet to an anonymous, persistent `humanId` (a World ID nullifier) — the same number for every wallet that human ever registers.
- Human-backed wallets get the **tight** fee and anonymous wallets get the **wide** fee. Both rates are dynamic: the currently deployed schedule is 16 / 44 bps around a 30 bps volume-weighted LP target. Never hardcode these example values in the interface.
- **The anti-cheat that makes it economically sound:** each human has a *daily volume quota* at the tight fee, and the quota is keyed to the `humanId`, not the wallet. Register a second wallet and it inherits the already-spent quota. Sybil attacks don't work. Bounded per-human volume means bounded risk for LPs, which is *why* the discount is rational rather than charity.
- The authoritative **on-chain volume controller** records every mined fill and changes the next fee pair so the volume-weighted LP rate stays near its configured target. Nuthatch exposes the indexed evidence to the UI and to an optional strategist agent; do not imply that an LLM is required for the live controller.

Built on three sponsor technologies: **World AgentKit** (proof of unique human backing and canonical AgentBook registration), **1inch Aqua + SwapVM** (the exchange layer; we added custom VM instruction opcode 34 `_humanGate`, which prices personhood inside the swap), and **The Graph / Nuthatch** (SQL + MCP indexing of per-tier execution and identity-mirror evidence).

The emotional core: **this pool can tell who you are, and it treats you better for being real.** Design should feel like that — discerning, precise, quietly on the user's side. Never surveillance-y or creepy: identity is anonymous (a nullifier, never a name), and the interface must make that reassuring rather than ominous.

### Deployed architecture and truth labels

- Production UI: `https://turing-pool.vercel.app`.
- Execution, Aqua, SwapVM, quota accounting, demo assets, and permissionless LP vaults run on **Base Sepolia (84532)**.
- Identity originates in the canonical AgentBook on **World Chain mainnet (480)**. An authenticated relayer publishes the canonical `humanId`, World block number, and World block hash into the Base AgentBook mirror. The SwapVM instruction reads that mirror synchronously.
- Liquidity is maker-owned test inventory plus permissionless Turing Pool vault inventory. This uses deployed Aqua and SwapVM contracts, but it does **not** route through public 1inch Aggregation Protocol liquidity. Never label it “1inch aggregated liquidity.”
- Nuthatch is live market-data and audit infrastructure. It is not the settlement layer and it does not sit in the critical path of a swap. The app safely falls back to direct Base event reads if the indexer is unavailable.
- All assets are explicitly demo assets (`tETH` and `tUSD`) on a testnet. Never present them as mainnet ETH or USDC.

Live contract references:

- World AgentBook: `0xA23aB2712eA7BBa896930544C7d6636a96b944dA`
- Base AgentBook mirror: `0x70b9FE7Bd162B0014df1E1f435dB47765Db62455`
- Aqua: `0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec`
- Primary SwapVM router: `0x02467E79C0aa8458F4552d427771D72C30F5a484`
- Primary HumanQuota: `0x23253c0e2aF22D83859F9f0B61b2ed45ED3Bd63B`
- Vault factory: `0x6B5dA84980f3205F0a6aCc9469c7b8279575cd10`
- Vault SwapVM router: `0x797670993d2E81266F8512C7438d5b3B1E9a49d6`
- Seeded vault: `0x3f0B4a7d12D368Db1F56a39F907C20Eb04809160`

## 2. Who is looking at it, and when

1. **Hackathon judges + sponsor engineers (primary).** In person, 3 minutes, over the designer's shoulder on a laptop, sometimes projected. They are technical, skeptical, and have seen 40 demos that day. They must be able to see, *without being told*: this is executing real transactions, identity is doing real work, and the numbers aren't fake.
2. **Sponsor reps from World, 1inch, and The Graph** looking for their own technology being used deeply — each needs a visible, verifiable home in the UI.
3. **Developers** who open the repo later and want to understand the system from the interface alone.

## 3. The narrative spine — the four beats

The interface must make this story legible *in order*, ideally on one screen without navigation:

1. **A bot asks for a price** → gets the wide fee. Baseline established.
2. **A human-backed agent asks for the same trade, same second** → gets the tight fee and visibly more output. This is the "aha." It should be the most arresting moment on screen.
3. **The same human's second wallet tries to reuse the cheap lane past its quota** → demoted to the wide fee. The sybil defense, shown rather than claimed.
4. **The on-chain volume controller re-prices the next trade** → both lane rates move after mined volume while the blended LP target holds. The pool adapts.

Design a way for the presenter to walk these beats without hunting for controls, and for a viewer who arrives at beat 3 to still understand beats 1–2 from what's on screen.

## 4. Full feature inventory to design

The live product already contains the functionality below. Redesign its hierarchy and components without breaking or replacing the existing API, wallet, transaction, contract, or indexing wiring.

**A. Market header / hero.** Live price, pool pair (tETH/tUSD demo assets), current tight vs wide fee, 30 bps LP target, runtime badge (`local` / `base-fork` / `base` / `world-chain` / `hosted-preview`), chain ID, latest block, RPC status, and refresh state. Must communicate at a glance whether this is live Base Sepolia execution or a static snapshot — honesty about mode is a hard requirement.

**B. The quote race (the money shot).** Prioritize the same trade size for two simultaneous takers: human-backed agent and anonymous bot. For each: output amount, fee tier, dynamic fee bps, whether human-backed, and truncated `humanId`. Make the human's output improvement the primary visual. Keep the linked-wallet/sybil quota proof compact or expandable rather than giving it equal hero weight.

**C. Trading terminal.** Connected-wallet trading via MetaMask: buy/sell direction, exact-input amount entry and presets, wallet balance, live output, allowance and balance checks, market order type, slippage selection, minimum received, price impact/live LP fee, network, and the explicit route `token → SwapVM opcode 34 → Aqua → token`. Preserve the approve-then-swap flow and progress stages: wallet → identity → allowance → simulation → submission → settlement → receipt → repricing → refresh. After execution show the transaction hash, Base block, amounts, tier, `humanId`, `HumanGated` event, opcode, and BaseScan link.

**D. World identity control.** Lets a real person register their wallet live: shows current status (not registered / registered on World Chain / mirrored to the demo chain), a QR code plus deep link to World App for verification, then a synchronization step that mirrors the registration to the demo chain, with phases (idle / connecting / registering / syncing / done / error). This is where a judge scans with their own phone and becomes a verified human in the demo — design it to be the most delightful 30 seconds of the pitch.

**E. Quota meter.** For the demo human: daily cap and remaining tight-tier allowance per token, how much is spent, and — critically — the fact that the allowance is shared across every wallet that human controls. Make the shared-ness visually obvious, because it's the anti-sybil argument.

**F. Fee controller panel.** The adaptive economics: current tight and wide fee, LP target fee, projected blended fee, revenue delta versus target, human share of volume (bps), per-tier volumes and fill counts, controller status, whether it can currently adjust, the formula in human-readable form, normalization note, and data source (on-chain volume controller vs event-derived recommendation). Also a copyable "replay this" command.

**G. Fee chart.** Fee levels over time / across re-pricings — tight vs wide series, with the LP target as a reference line.

**H. LP economics panel.** The argument that this protects liquidity providers: revenue captured, flow mix (benign vs toxic), effect of the tiering, blended fee versus target.

**I. Evidence ledger / swap feed.** Every fill: block, transaction hash, taker, tier, amounts in/out, fee bps, `humanId`, and which venue executed it (custom Aqua app vs SwapVM router). Plus strategy history: each re-pricing with old → new fee pair, whether it was the initial ship or a re-price, and its transaction. This panel's job is *proof* — a judge should be able to click into a real explorer.

**J. Integration flow diagram.** Show the real sequence: World AgentBook → Base identity mirror → SwapVM opcode 34 → Aqua settlement → on-chain volume-controller update → The Graph/Nuthatch indexed evidence. Distinguish synchronous execution stages from asynchronous indexing stages. It should light up along the path when a real trade happens.

**K. Vault workspace (permissionless liquidity).** Anyone can create a two-token pool; any LP can deposit both assets, receive transferable ERC-20 shares, and redeem pro-rata. Per vault: reserves, total share supply, your shares and token balances, allowances, manager, whether the strategy is active, whether deposits are paused, order hash, and separate fee schedules per token. Actions: create vault, deposit, redeem, swap, and the approvals each needs — each returning a prepared transaction for the wallet to sign. Also a vault registry / picker when several exist.

**L. Protocol details / provenance.** All contract addresses (Aqua, World AgentBook, Base mirror, app, primary and vault routers, quota, vault factory, and seeded vault), identity provenance (World chain and source block), and the status of every data source: quotes, strategy, activity indexer (indexed block, sealed-through block, lag, `sql+mcp` / `graphql` / `chain-events`, and fallback), plus the optional strategist. Judges *will* look here for “is this real” — make transparency feel like confidence, not fine print.

## 5. States and edge cases to design

Do not design only the happy path. Cover:

- Initial load / skeleton; background refresh without layout jump.
- Wallet not connected; wrong network; wallet request rejected.
- These specific error codes, each needing distinct treatment and a clear recovery: `rpc_rate_limited` (with retry-after countdown), `trade_busy`, `execution_unavailable`, `insufficient_balance`, `trade_failed`, `invalid_trade_request`, `trade_forbidden`, `wallet_unavailable`, `wallet_rejected`, `wrong_network`, `network_error`.
- Over-quota (tight tier unavailable to a verified human) — must read as "limit reached," never as "you failed verification."
- Quota fully spent; quota reset boundary.
- Indexer lagging, unavailable, or falling back to direct chain scans — visible, honest, and not alarming.
- Hosted-preview / snapshot mode where trading is disabled: must clearly not masquerade as live.
- Vault paused (redemptions still allowed), vault with no liquidity, first-deposit ratio-setting case, zero vaults.
- Identity: unregistered, registered upstream but not yet mirrored, verification abandoned mid-flow, sync failure.
- Empty states: no fills yet, no re-pricings yet, no strategist data yet.

## 6. Design direction

- **Not a generic crypto dashboard.** No neon-on-black casino aesthetic, no gradient soup, no glassmorphism for its own sake. Aim closer to a precise professional trading instrument that a designer actually touched — think institutional clarity with one confident personality move.
- Find a visual metaphor for **two lanes** (verified vs anonymous) and carry it consistently: the same two colors mean the same two things everywhere, always. Color follows the entity, never its rank.
- Identity should feel like a **credential**, not a profile: anonymous, cryptographic, dignified. The `humanId` is a long number — treat it as a badge or seal, never as a username.
- Numbers are the product. Tabular figures for all amounts, monospace for hashes and addresses (truncated with copy affordances), units always labeled, no ambiguous decimals.
- Motion earns its place: the quote race resolving, a stage completing in the stepper, a fee re-pricing, the integration path lighting up. Everything else stays still. Nothing should bounce.
- Must survive a projector: large type for the hero numbers, high contrast, nothing critical conveyed by a 1px line or a pale tint.

**Data-visualization rules (non-negotiable):** never a dual-axis chart; sequential scales are one hue light→dark; diverging scales are two hues with a neutral gray midpoint; a legend is present whenever two or more series appear, plus direct labels on key points so identity is never conveyed by color alone; grids and axes stay recessive; text uses text colors, never series colors; status colors (good / warning / critical) are reserved and always ship with an icon or label. Verify every categorical pair is distinguishable for color-vision deficiency and clears 3:1 contrast against its surface.

**Theming:** prioritize one excellent dark institutional trading palette for the hackathon. A deliberate light palette and toggle are welcome only after the primary desktop, projected, and mobile flows are complete.

**Responsive:** primary target 1280×800 laptop and 1920×1080 projected. Also design a usable phone layout — a judge will scan the World App QR code and may then poke at the site on their own phone. Wide content (tables, charts) scrolls inside its own container; the page itself never scrolls sideways.

**Accessibility:** full keyboard operability including the trading flow, visible focus states, semantic structure, live-region announcements for trade progress and errors, and a table view available for every chart.

## 7. Deliverables

1. A recommended information architecture: what belongs above the fold, what groups together, what collapses — optimized for the four-beat demo, with your reasoning.
2. High-fidelity layouts for: the main dashboard (default, and mid-trade), the identity verification flow, the vault workspace, and a phone layout.
3. The state matrix rendered — at minimum: loading, wallet disconnected, wrong network, trade in progress, trade succeeded with receipt, rate-limited error, over-quota, indexer degraded, snapshot mode, vault paused.
4. A design-token set (color roles for both themes, type scale, spacing, radii, elevation) and component specs for: stat tile, quote-race card, fee badge, tier pill, quota meter, progress stepper, receipt card, data table row, address/hash chip, data-source status chip, chart frame, and the empty/error blocks.
5. Motion notes for the four narrative moments.
6. A short rationale tying the visual decisions back to the product argument.

Implement the approved design in the existing **React 19 + Vite** application using its live types, APIs, and state. Do not replace it with a standalone HTML prototype. Use realistic dynamic values consistent with the current deployment — presently 16 bps tight, 44 bps wide, a 30 bps LP target, a 10 tETH daily human cap, and a four-figure price — while making clear that mined volume changes the fee pair.

## 8. Anti-patterns to avoid

- Burying the human-versus-bot price difference below the fold, or making it a table row instead of the hero.
- Implying the interface has verified someone's *identity* rather than their *unique personhood*.
- Making the over-quota state look like a rejection or a failure.
- Presenting snapshot or fork data as live mainnet state.
- A wall of equal-weight panels with no hierarchy, so the eye has nowhere to land.
- Explaining the mechanism only in prose. The mechanism should be visible in the layout: two lanes, one shared cap, one adaptive controller, one audit trail.
