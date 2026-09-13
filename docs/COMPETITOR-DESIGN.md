# Trading UX review and implementation

Reviewed 2026-09-08. Scope: order entry and monitoring, not a feature or security
ranking. No competitor wallets were connected and no trades were submitted.

## Evidence

| Product | Observed pattern | Applied to Turing |
| --- | --- | --- |
| [Uniswap limit orders](https://support.uniswap.org/hc/en-us/articles/24468305718541-How-to-create-a-limit-order) | Official illustrated guide separates tokens, amount, execution price, expiry, review, and signing. Live app rendered blank in this browser; no claim of live visual verification. | Concrete fields and explicit draft/review boundary, instead of requiring users to compose prose. |
| [CoW Swap TWAP](https://docs.cow.fi/cow-protocol/tutorials/cow-swap/twap) | Parameters include parts, duration and calculated per-part amounts; monitoring exposes individual parts and receipts. Live swap shell also groups Swap, Limit and TWAP. | Per-trade preview, visible limits, separate progress panel and retained per-slice receipts. |
| [Jupiter DCA](https://developers.jup.ag/docs/trigger/dca) | Live recurring page has token budget, interval/order fields, optional price range, a per-order summary and separate open/past orders. Current docs describe keeper execution from a funded vault. | Compact structured ticket, optional risk settings, natural-language entry as a secondary mode. Do not copy the custody or unattended-execution promises. |

The former Jupiter Recurring API is superseded by Trigger DCA; it is not an
integration recommendation. CoW documentation contains inconsistent historical
minimum amounts, so this review does not rely on its pricing/minimum claims.

## Product decision

Turing is a conditional, wallet-approved strategy product, not a perpetuals
terminal or an unattended DCA keeper. A large chart and an equally large prompt
box obscure the user's job. Keep the dark exchange shell, but make the right-hand
ticket the creation surface and the left-hand panel the monitoring surface.
On phones, order entry comes first, progress second, optional market context third.

The primary form accepts budget, direction, trade count and validity period.
Fees, dispersion and unverified flow are explicit adjustable execution limits.
Percent inputs are converted to the existing API's basis points. Amounts are
converted to integer token units without floating-point conversion. Invalid
fields are rejected before the planner can silently clamp them.

Generation only creates a draft. Activation and individual wallet approvals remain
separate. Expiry is labeled as a validity window, never a trade schedule.
Custom instructions remain available; editing them does not silently change the
structured fields. The resulting server draft is the authoritative review.

No fake PnL, yield estimates, order-book depth, unsupported chains, fake scheduling
or competitor integrations were added.

## Verification

- Structured input round-trip through the real planner, including 18-decimal
  precision, direction, all limits and expiry.
- Invalid and out-of-range field rejection.
- Existing generate/activate/re-evaluate/execution separation and timeout tests.
- TypeScript, production build, desktop/mobile visual inspection and browser
  interaction with order-entry modes and preview.
