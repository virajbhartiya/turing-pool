import { formatUnits } from '../lib/format';
import { deriveLpEconomics } from '../lib/lpEconomics';
import type { ProtocolState } from '../types';

export interface LPEconomicsPanelProps {
  state: ProtocolState;
  token0Symbol?: string;
  token1Symbol?: string;
  token0Decimals?: number;
  token1Decimals?: number;
  /** Optional live token1 price for one token0 (for example, tUSD per tETH). */
  token0PriceInToken1?: number;
}

function bpsLabel(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)} bps`;
}

export function LPEconomicsPanel({
  state,
  token0Symbol = 'tETH',
  token1Symbol = 'tUSD',
  token0Decimals = 18,
  token1Decimals = 18,
  token0PriceInToken1,
}: LPEconomicsPanelProps) {
  const economics = deriveLpEconomics(state, {
    token0Decimals,
    token1Decimals,
    token0PriceInToken1,
  });
  const estimatedFeeValue = economics.estimatedImpliedFeesToken1?.toLocaleString(
    'en-US',
    { maximumFractionDigits: 4 },
  );

  return (
    <section className="controller-section" id="lp" aria-label="LP economics">
      <div className="terminal-panel">
        <div className="panel-head">
          <div>
            <strong>Market fee performance</strong>
            <span>Derived from mined fills in the active controller window</span>
          </div>
          <span className="live-tag">ON-CHAIN</span>
        </div>

        <div className="metric-strip lp-metrics">
          <div className="metric">
            <span>Estimated fee income</span>
            <strong>
              {formatUnits(economics.total.impliedFees.token0, token0Decimals, 6)} {token0Symbol}
            </strong>
            <small>
              {formatUnits(economics.total.impliedFees.token1, token1Decimals, 6)} {token1Symbol}
              {estimatedFeeValue === undefined ? '' : ` · ≈ ${estimatedFeeValue} ${token1Symbol}`}
            </small>
          </div>
          <div className="metric">
            <span>Executed volume</span>
            <strong>{formatUnits(economics.total.normalizedVolumeToken0, token0Decimals, 4)} {token0Symbol}</strong>
            <small>input notional across both lanes</small>
          </div>
          <div className="metric">
            <span>Realized blended rate</span>
            <strong>{bpsLabel(economics.realizedBlendedFeeBps)}</strong>
            <small>{state.feeController.targetFeeBps} bps controller target</small>
          </div>
          <div className="metric">
            <span>Settled fills</span>
            <strong>{economics.total.swapCount}</strong>
            <small>{economics.human.swapCount} verified · {economics.bot.swapCount} anonymous</small>
          </div>
        </div>
      </div>
      <p className="lp-disclaimer">
        Fee income is estimated from each mined receipt’s input and applied rate.
      </p>
    </section>
  );
}
