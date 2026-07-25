import { formatUnits } from '../lib/format';
import { deriveLpEconomics, type TierLpEconomics } from '../lib/lpEconomics';
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

function TierCard({
  label,
  tone,
  tier,
  token0Symbol,
  token1Symbol,
  token0Decimals,
  token1Decimals,
  currentFeeBps,
}: {
  label: string;
  tone: 'human' | 'bot';
  tier: TierLpEconomics;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  currentFeeBps: number;
}) {
  return (
    <article className={`quote-card ${tone}`}>
      <div className="quote-card-head">
        <span><i />{label}</span>
        <b>{currentFeeBps} BPS NOW</b>
      </div>
      <strong>
        {formatUnits(tier.normalizedVolumeToken0, token0Decimals, 4)}
        <small>{token0Symbol}-notional</small>
      </strong>
      <p>
        Receipt analytics use {token0Symbol}-equivalent volume; reverse fills use
        received {token0Symbol}. Controllers stay input-token specific.
      </p>
      <div className="quote-card-foot">
        <span>{tier.swapCount} mined fills</span>
        <b>
          Input: {tokenPairLabel(
            tier.inputVolume.token0,
            tier.inputVolume.token1,
            token0Symbol,
            token1Symbol,
            token0Decimals,
            token1Decimals,
          )}
        </b>
      </div>
      <em>
        Implied LP fee: {tokenPairLabel(
          tier.impliedFees.token0,
          tier.impliedFees.token1,
          token0Symbol,
          token1Symbol,
          token0Decimals,
          token1Decimals,
        )}
      </em>
    </article>
  );
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
            <strong>LP economics · executed fee ledger</strong>
            <span>
              Receipt-implied fees stay separated by input token · cross-token values use
              receipt notional
            </span>
          </div>
          <span className="live-tag">{economics.total.swapCount} FILLS</span>
        </div>

        <div className="metric-strip">
          <div className="metric">
            <span>Live {activeTokenInSymbol} input rates</span>
            <strong>
              {activeHumanFee} / {activeBotFee} bps
            </strong>
            <small>human-backed / anonymous · next executable quote</small>
          </div>
          <div className="metric">
            <span>Executed notional</span>
            <strong>
              {formatUnits(
                economics.total.normalizedVolumeToken0,
                token0Decimals,
                4,
              )}
            </strong>
            <small>{token0Symbol}-notional · receipt window</small>
          </div>
          <div className="metric">
            <span>Cumulative implied fees</span>
            <strong>
              {formatUnits(economics.total.impliedFees.token0, token0Decimals, 6)} /{' '}
              {formatUnits(economics.total.impliedFees.token1, token1Decimals, 6)}
            </strong>
            <small>
              {token0Symbol} / {token1Symbol} · not directly summed
              {economics.estimatedImpliedFeesToken1 === undefined
                ? ''
                : ` · ≈ ${economics.estimatedImpliedFeesToken1.toLocaleString('en-US', {
                    maximumFractionDigits: 4,
                  })} ${token1Symbol}`}
            </small>
          </div>
          <div className="metric">
            <span>Realized blended rate</span>
            <strong>{bpsLabel(economics.realizedBlendedFeeBps)}</strong>
            <small>historical receipt rates × normalized notional</small>
          </div>
          <div className="metric">
            <span>Projected fee revenue</span>
            <strong>~{projectedToken0}</strong>
            <small>
              {token0Symbol}-notional on controller volume
              {projectedToken1 === undefined
                ? ''
                : ` · ≈ ${projectedToken1} ${token1Symbol}`}
            </small>
          </div>
        </div>

        <div className="quote-comparison">
          <TierCard
            label="Human-backed flow"
            tone="human"
            tier={economics.human}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            token0Decimals={token0Decimals}
            token1Decimals={token1Decimals}
            currentFeeBps={activeHumanFee}
          />
          <TierCard
            label="Anonymous flow"
            tone="bot"
            tier={economics.bot}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            token0Decimals={token0Decimals}
            token1Decimals={token1Decimals}
            currentFeeBps={activeBotFee}
          />
        </div>

        <div className="comparison-tape">
          <strong>
            Controller projection{' '}
            <b>{bpsLabel(economics.projectedBlendedFeeBps)}</b>
          </strong>
          <span>
            {formatUnits(economics.controllerVolumeToken0, token0Decimals, 4)}{' '}
            {token0Symbol} controller base · target {state.feeController.targetFeeBps} bps
            {activeTokenInSymbol === token0Symbol ? '' : ` · active ${activeTokenInSymbol} target ${activeTargetFee} bps`}
            {token0PriceInToken1 === undefined
              ? ' · supply a live mid-price for token1 estimate'
              : ` · ${token0PriceInToken1.toLocaleString('en-US')} ${token1Symbol}/${token0Symbol}`}
          </span>
        </div>
      </div>
      <div className="connection-bar">
        <span>
          <i />
          Implied fees apply each mined receipt’s fee rate to its input amount.
        </span>
        <span>
          Estimated notional is directional and is not realized accounting P&amp;L.
        </span>
      </div>
    </section>
  );
}
