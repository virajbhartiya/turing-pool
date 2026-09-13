# Turing Autopilot — ETHGlobal video pitch

## The one-line hook

**Turing turns “buy this over time, when the market is safe” into a human-approved, evidence-gated position that executes one verifiable slice at a time.**

## 90-second voiceover

At Lisbon, I built TuringSwap.

The main idea was simple: **identity should matter in a financial market.**

I used World AgentBook to verify that a wallet belongs to a real human, and Aqua
to make sure those identity-based rules actually carry through to execution.

For ETHOnline, I wanted to take that idea one step further.

I asked myself: what if instead of manually making every trade, I could just
tell Turing what I want to achieve?

So I built **Turing Autopilot**.

For example, I can say: I want to spend 20 tUSD buying ETH, split across two
trades, and only execute when certain market conditions are met.

Let me show you.

**[Open Autopilot]**

I enter 20 tUSD and choose two trades.

When I hit Generate, Turing turns that into an actual strategy.

It gives the strategy clear limits — how long it is valid, how much I am
willing to pay, and how much market movement I am willing to tolerate.

And generating the strategy does not give Turing access to my funds.

**[Show “Your strategy review” / “Order progress”]**

The next thing I added is the evidence layer.

Before I execute anything, I check the wallet through AgentBook, and I pull
market data from Nuthatch.

So instead of just saying that a trade is safe, Turing shows me exactly what it
is checking, where the evidence came from, and whether the conditions passed.

**[Show identity + Nuthatch checks]**

Now I activate the strategy.

But Autopilot does not mean handing over my wallet.

Every trade is checked separately.

If the conditions are not right, it waits. Nothing gets sent.

And when the conditions are right, I still approve and sign the transaction
myself.

**[Execute slice 1]**

Here, everything passes.

I approve the first trade, sign it with my wallet, and Aqua handles the
execution.

Once it settles, Turing records the actual transaction and updates the
remaining budget.

**[Show receipt + remaining amount]**

Then I do the same thing for the second trade.

**[Execute slice 2]**

And now the strategy is complete.

I have the transaction receipts showing exactly what happened.

So, what did I actually add?

I took the identity-aware market I built at Lisbon and added a layer between
**intent and execution**.

I can describe what I want, Turing checks the conditions and the evidence, I
stay in control of every transaction, and the final execution becomes
verifiable proof.

**Lisbon was about building the market. ETHOnline is about making that market
usable for real intents.**

## Capture plan

Record one continuous browser take at `http://127.0.0.1:4022/#autopilot` using the
isolated demo documented in [DEMO-MARKET.md](./DEMO-MARKET.md). Keep the local
sandbox banner visible when first opening the app; it makes the provenance of
the rehearsal honest. Use account #3 for manual signing while the two background
actors keep Activity moving.

1. **Open Autopilot:** land on the hero and click **Build a strategy**.
2. **Build + review:** enter `20` tUSD and `2` trades; click **Generate**. Hold
   on the **Your strategy review / Order progress** card. Make the compiled
   direction, `0 of 2` progress, remaining budget, expiry, max fee, max
   dispersion, and searcher-flow limit legible. The background market activity
   should be visible in the chart or Activity rows while this card is open.
3. **Passport/evidence:** stay on that same review card and reveal the connected
   wallet, human-backed badge, Nuthatch provenance, indexed block, and green
   checks. The review is where evidence becomes a decision.
4. **Execution:** Activate, Execute slice 1, approve if prompted,
   sign, then open its local receipt. Return, Execute slice 2, and sign.
5. **Proof (1:20–1:30):** hold on “Strategy complete”, the two receipt links,
   and the Activity page with fresh rows. A short cut to Liquidity can replace
   Activity if the judging rubric values the Aqua LP path.

## Continuity track for the submission

Say the boundary plainly: **Lisbon shipped the identity-priced Aqua market;
ETHOnline ships the intent-to-proof layer on top of it.**

| Lisbon baseline | ETHOnline continuation shown in the video |
|---|---|
| World AgentBook identity and `_humanGate` pricing | Agent Passport attached to a strategy owner |
| Aqua/SwapVM single-swap settlement | Persistent conditional DCA with independently checked slices |
| Per-human quota and adaptive fees | Risk policy compiled from intent and re-evaluated before every slice |
| Nuthatch indexes market activity | Nuthatch evidence drives a visible pass/fail decision |
| Swap and LP terminals | One judge-facing workspace: observe → reason → execute → prove |
| Wallet-signed trades | Human activation, pause, per-slice approval, and receipt reconciliation |

The final frame should show the old/new relationship in one sentence:
**“Turing Autopilot does not replace TuringSwap’s market; it makes that market
usable for a conditional goal while preserving its identity, Aqua settlement,
and human authority.”**

## What not to claim

Call the continuous actors **local demo market activity**, not real customers or
an unattended mainnet market maker. The video may show the mainnet architecture
and read-only simulations, but any fresh World Chain transaction must be signed
from the presenter’s wallet and labelled as such. Deployment is intentionally
outside this continuity demo.

## 20-second backup version

“TuringSwap made identity-priced Aqua markets possible. Turing Autopilot makes
them usable for outcomes: describe a bounded goal, verify the human-backed
wallet and live Nuthatch evidence, then sign each safe slice yourself. If the
market fails the policy, nothing is sent. If it passes, Aqua settles the trade,
and the receipt becomes proof. Lisbon built the market. ETHOnline adds the
human-controlled path from intent to execution.”
