import { unitsAsNumber } from '../lib/format';
import type { DemoQuotes } from '../types';

interface MarketHeaderProps {
  quotes: DemoQuotes;
}

export function MarketHeader({
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

  return (
    <section className="market-header compact-market-header" id="market">
      <div>
        <div className="breadcrumb">Markets / <span>TETH–TUSD</span></div>
        <div className="pair-title">
          <span className="pair-icon" aria-hidden="true"><i>Ξ</i><i>$</i></span>
          <div>
            <h1>tETH / tUSD <span>Identity-priced spot</span></h1>
            <p>SwapVM execution through Aqua · fees update after mined volume</p>
          </div>
        </div>
      </div>
      <div className="market-price">
        <span>Verified executable price</span>
        <strong>{humanPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        <small>tUSD / tETH</small>
        <em>+{identityEdgeBps} BPS VS SEARCHER</em>
      </div>
    </section>
  );
}
