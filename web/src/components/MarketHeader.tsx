import { unitsAsNumber } from '../lib/format';
import type { DemoQuotes, ProtocolState } from '../types';

interface MarketHeaderProps {
  state: ProtocolState;
  quotes: DemoQuotes;
}

export function MarketHeader({
  state,
  quotes,
}: MarketHeaderProps) {
  const reverse = quotes.direction === 'tUSD-to-tETH';
  const humanPrice = reverse
    ? unitsAsNumber(quotes.human.amountIn) / unitsAsNumber(quotes.human.amountOut)
    : unitsAsNumber(quotes.human.amountOut) / unitsAsNumber(quotes.human.amountIn);
  const identityEdgeBps =
    quotes.improvementBps ??
    Number(
      ((BigInt(quotes.human.amountOut) - BigInt(quotes.bot.amountOut)) * 10_000n) /
        BigInt(quotes.bot.amountOut),
    );
  const humanShare = state.feeController.humanShareBps / 100;

  return (
    <>
      <section className="market-tape" aria-label="Live market tape">
        <article className="human">
          <span>Verified human fee</span>
          <div>
            <strong>Tight lane</strong>
            <b>{quotes.human.feeBps} bps</b>
          </div>
          <small>Bounded World-backed flow</small>
        </article>
        <article className="bot">
          <span>HFT / arbitrage fee</span>
          <div>
            <strong>Searcher lane</strong>
            <b>{quotes.bot.feeBps} bps</b>
          </div>
          <small>Variable pricing for automated order flow</small>
        </article>
        <article className="target">
          <span>LP blended fee</span>
          <div>
            <strong>{state.feeController.projectedWeightedFeeBps.toFixed(1)} bps</strong>
            <b>{state.feeController.targetFeeBps} target</b>
          </div>
          <small>{humanShare.toFixed(1)}% verified volume · revenue-neutral controller</small>
        </article>
      </section>

      <section className="market-header compact-market-header" id="market">
        <div>
          <div className="breadcrumb">Markets / <span>TETH–TUSD</span></div>
          <div className="pair-title">
            <span className="pair-icon" aria-hidden="true"><i>Ξ</i><i>$</i></span>
            <div>
              <h1>tETH / tUSD <span>Identity-priced spot</span></h1>
              <p>Live SwapVM execution through Aqua · fees reprice after mined volume</p>
            </div>
          </div>
        </div>
        <div className="market-price">
          <span>Verified executable price</span>
          <strong>{humanPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          <small>tUSD / tETH</small>
          <em>+{identityEdgeBps} BPS VS ANONYMOUS</em>
        </div>
      </section>

    </>
  );
}
