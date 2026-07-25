import { formatUnits } from '../lib/format';
import { deriveLpEconomics } from '../lib/lpEconomics';
import type { DemoQuotes, DemoTokenSymbol, ProtocolState } from '../types';

export interface LPEconomicsPanelProps {
  state: ProtocolState;
  token0Symbol?: string;
  token1Symbol?: string;
  token0Decimals?: number;
  token1Decimals?: number;
  /** Optional live token1 price for one token0 (for example, tUSD per tETH). */
  token0PriceInToken1?: number;
  activeFeeSchedule?: DemoQuotes['feeSchedule'];
  activeTokenInSymbol?: DemoTokenSymbol;
}

function bpsLabel(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)} bps`;
}

function tokenPairLabel(
  token0: bigint,
  token1: bigint,
  token0Symbol: string,
  token1Symbol: string,
  token0Decimals: number,
  token1Decimals: number,
): string {
  return `${formatUnits(token0, token0Decimals, 6)} ${token0Symbol} / ${formatUnits(
    token1,
    token1Decimals,
    6,
  )} ${token1Symbol}`;
}

export function LPEconomicsPanel({
  state,
  token0Symbol = 'tETH',
  token1Symbol = 'tUSD',
  token0Decimals = 18,
  token1Decimals = 18,
  token0PriceInToken1,
  activeFeeSchedule,
  activeTokenInSymbol = 'tETH',
}: LPEconomicsPanelProps) {
  const economics = deriveLpEconomics(state, {
    token0Decimals,
    token1Decimals,
    token0PriceInToken1,
  });
  const projectedToken0 = formatUnits(
    economics.projectedFeeNotionalToken0,
    token0Decimals,
    6,
  );
  const projectedToken1 =
    economics.estimatedProjectedFeeToken1 === undefined
      ? undefined
      : economics.estimatedProjectedFeeToken1.toLocaleString('en-US', {
          maximumFractionDigits: 4,
        });
  const activeHumanFee = Number(
    activeFeeSchedule?.tightFeeBps ?? economics.human.currentFeeBps,
  );
  const activeBotFee = Number(
    activeFeeSchedule?.wideFeeBps ?? economics.bot.currentFeeBps,
  );
  const activeTargetFee = Number(
    activeFeeSchedule?.targetFeeBps ?? state.feeController.targetFeeBps,
  );

  return (
    <section className="controller-section" id="lp" aria-label="LP economics">
      <div className="terminal-panel">
        <div className="panel-head">
          <div>
            <strong>LP book</strong>
            <span>What the pool is charging now and what executed flow has earned</span>
          </div>
          <span className="live-tag">{economics.total.swapCount} FILLS</span>
        </div>

        <div className="metric-strip lp-metrics">
          <div className="metric">
            <span>Current rates</span>
            <strong>
              {activeHumanFee} / {activeBotFee} bps
            </strong>
            <small>verified / anonymous · next {activeTokenInSymbol} quote</small>
          </div>
          <div className="metric">
            <span>LP target / projected</span>
            <strong>{activeTargetFee} / {bpsLabel(economics.projectedBlendedFeeBps)}</strong>
            <small>controller target / current volume-weighted rate</small>
          </div>
          <div className="metric">
            <span>Estimated fees earned</span>
            <strong>
              {formatUnits(economics.total.impliedFees.token0, token0Decimals, 6)} /{' '}
              {formatUnits(economics.total.impliedFees.token1, token1Decimals, 6)}
            </strong>
            <small>
              {token0Symbol} / {token1Symbol}
              {economics.estimatedImpliedFeesToken1 === undefined
                ? ''
                : ` · ≈ ${economics.estimatedImpliedFeesToken1.toLocaleString('en-US', {
                    maximumFractionDigits: 4,
                  })} ${token1Symbol}`}
            </small>
          </div>
          <div className="metric">
            <span>Executed volume</span>
            <strong>{formatUnits(economics.total.normalizedVolumeToken0, token0Decimals, 4)}</strong>
            <small>
              {token0Symbol}-notional · realized {bpsLabel(economics.realizedBlendedFeeBps)}
            </small>
          </div>
        </div>

        <div className="lp-flow-book">
          <div className="lp-flow-head">
            <span>Flow</span><span>Volume</span><span>Fills</span><span>Live rate</span><span>Implied fee earned</span>
          </div>
          <div className="lp-flow-row human">
            <strong><i />Verified human</strong>
            <span>{formatUnits(economics.human.normalizedVolumeToken0, token0Decimals, 4)} {token0Symbol}</span>
            <span>{economics.human.swapCount}</span>
            <b>{activeHumanFee} bps</b>
            <span>{tokenPairLabel(economics.human.impliedFees.token0, economics.human.impliedFees.token1, token0Symbol, token1Symbol, token0Decimals, token1Decimals)}</span>
          </div>
          <div className="lp-flow-row bot">
            <strong><i />Anonymous bot</strong>
            <span>{formatUnits(economics.bot.normalizedVolumeToken0, token0Decimals, 4)} {token0Symbol}</span>
            <span>{economics.bot.swapCount}</span>
            <b>{activeBotFee} bps</b>
            <span>{tokenPairLabel(economics.bot.impliedFees.token0, economics.bot.impliedFees.token1, token0Symbol, token1Symbol, token0Decimals, token1Decimals)}</span>
          </div>
        </div>

        <div className="comparison-tape lp-projection">
          <strong>
            Next-window projection <b>~{projectedToken0} {token0Symbol}</b>
          </strong>
          <span>
            {formatUnits(economics.controllerVolumeToken0, token0Decimals, 4)}{' '}
            {token0Symbol} controller base
            {projectedToken1 === undefined ? '' : ` · ≈ ${projectedToken1} ${token1Symbol}`}
          </span>
        </div>
      </div>
      <p className="lp-disclaimer">
        Fee estimates apply each mined receipt’s rate to its input amount; cross-token values are indicative, not realized accounting P&amp;L.
      </p>
    </section>
  );
}
