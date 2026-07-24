import { compactUsd, formatUnits, shortAddress, unitsAsNumber } from '../lib/format';
import type { DemoQuotes, ProtocolState } from '../types';

interface MarketHeaderProps {
  state: ProtocolState;
  quotes: DemoQuotes;
  refreshing: boolean;
}

function Metric({
  label,
  value,
  detail,
  positive = false,
}: {
  label: string;
  value: string;
  detail: string;
  positive?: boolean;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={positive ? 'positive' : undefined}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function MarketHeader({ state, quotes, refreshing }: MarketHeaderProps) {
  const humanPrice = unitsAsNumber(quotes.human.amountOut) / unitsAsNumber(quotes.human.amountIn);
  const botPrice = unitsAsNumber(quotes.bot.amountOut) / unitsAsNumber(quotes.bot.amountIn);
  const poolToken0 = unitsAsNumber(state.pool.balance0);
  const poolToken1 = unitsAsNumber(state.pool.balance1);
  const poolNotional = poolToken1 + poolToken0 * humanPrice;
  const humanShare = state.feeController.humanShareBps / 100;
  const cap = BigInt(state.demoHuman.dailyCapToken0);
  const remaining = BigInt(state.demoHuman.quotaRemainingToken0);
  const quotaUsed = cap > 0n ? Number(((cap - remaining) * 100n) / cap) : 0;
  const isSnapshot = state.runtime.mode === 'hosted-preview';
  const canonicalAqua = '0x499943e74fb0ce105688beee8ef2abec5d936d31';
  const aquaLabel = isSnapshot
    ? '1inch Aqua (recorded)'
    : state.contracts.aqua.toLowerCase() === canonicalAqua
      ? '1inch Aqua (canonical)'
      : 'Aqua protocol deployment';
  const contracts = [
    [aquaLabel, state.contracts.aqua],
    [`World AgentBook (${state.runtime.agentBook})`, state.contracts.agentBook],
    ['TuringPoolApp', state.contracts.app],
    ['SwapVM Router', state.contracts.router],
    ['HumanQuota', state.contracts.quota],
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <a className="brand" href="#market" aria-label="Turing Pool market">
            <span className="brand-mark">T</span>
            <span>Turing Pool</span>
          </a>
          <nav className="primary-nav" aria-label="Primary navigation">
            <a className="active" href="#market">Market</a>
            <a href="#activity">Activity</a>
            <a href="#risk">Risk</a>
          </nav>
        </div>
        <div className="network-pill">
          <i className={refreshing ? 'refreshing' : undefined} />
          {isSnapshot ? 'Hosted snapshot' : `Live · ${state.runtime.label}`}
        </div>
      </header>

      <section className="market-header" id="market">
        <div>
          <div className="breadcrumb">Protocol / Markets / <span>tETH–tUSD</span></div>
          <div className="pair-title">
            <span className="pair-icon" aria-hidden="true"><i>Ξ</i><i>$</i></span>
            <div>
              <h1>Turing Pool <span>tETH / tUSD</span></h1>
              <p>Identity-priced liquidity · adaptive fee market · {state.runtime.label}</p>
            </div>
          </div>
        </div>
        <div className="market-price">
          <span>Verified agent quote</span>
          <strong>{humanPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          <small>tUSD / tETH</small>
          <em>▲ {(humanPrice - botPrice).toFixed(2)} vs anonymous</em>
        </div>
      </section>

      <section className="metric-strip" aria-label="Market metrics">
        <Metric
          label="Pool notional"
          value={compactUsd(poolNotional)}
          detail={`${formatUnits(state.pool.balance0, 18, 1)} tETH + ${formatUnits(state.pool.balance1, 18, 0)} tUSD`}
        />
        <Metric
          label="LP fee target"
          value={`${state.feeController.targetFeeBps} bps`}
          detail="revenue-neutral blend"
          positive
        />
        <Metric
          label="Human notional"
          value={`${humanShare.toFixed(1)}%`}
          detail={`${formatUnits(state.feeController.tightVolume)} verified / ${formatUnits(state.feeController.wideVolume)} anonymous tETH`}
        />
        <Metric
          label="Quota utilized"
          value={`${quotaUsed}%`}
          detail="shared across linked wallets"
        />
        <Metric
          label="Settled fills"
          value={String(state.stats.totalSwaps)}
          detail={`block ${state.runtime.latestBlock}`}
        />
      </section>

      <div className={`connection-bar ${isSnapshot ? 'snapshot' : 'connected'}`} role="status">
        <span><i />{isSnapshot ? 'Deterministic preview · no executable funds' : `RPC connected · chain ${state.runtime.chainId} · every quote is an on-chain eth_call`}</span>
        <strong>on-chain volume controller</strong>
      </div>

      <details className="deployment-details">
        <summary><span>Protocol deployment</span><span>Inspect contracts +</span></summary>
        <div className="contract-chips">
          {contracts.map(([name, address]) => (
            <span className="contract-chip" key={name} title={address}>
              <b>{name}</b>{shortAddress(address)}
            </span>
          ))}
        </div>
      </details>
    </>
  );
}
