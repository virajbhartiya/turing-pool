import { compactUsd, formatUnits, shortAddress, unitsAsNumber } from '../lib/format';
import type { DemoQuotes, ProtocolState } from '../types';
import { BrandLogo } from './BrandLogo';

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
            <span className="brand-mark">TP</span>
            <span className="brand-copy">
              <strong>Turing Pool</strong>
              <small>Risk execution</small>
            </span>
          </a>
          <nav className="primary-nav" aria-label="Primary navigation">
            <a aria-current="page" className="active" href="#market"><kbd>F1</kbd> Market</a>
            <a href="#activity"><kbd>F2</kbd> Execution</a>
            <a href="#lp"><kbd>F3</kbd> LP book</a>
            <a href="#risk"><kbd>F4</kbd> Risk</a>
          </nav>
        </div>
        <div className="topbar-status">
          <span className="block-tick">BLK {state.runtime.latestBlock}</span>
          <div className="network-pill">
            <i className={refreshing ? 'refreshing' : undefined} />
            {isSnapshot ? 'Hosted snapshot' : `Live · ${state.runtime.label}`}
          </div>
        </div>
      </header>

      <section className="market-header" id="market">
        <div>
          <div className="breadcrumb">Risk markets / World Chain / <span>TETH–TUSD</span></div>
          <div className="pair-title">
            <span className="pair-icon" aria-hidden="true"><i>Ξ</i><i>$</i></span>
            <div>
              <h1>tETH / tUSD <span>Turing Pool</span></h1>
              <p>One liquidity pool that prices bounded human flow and anonymous flow differently.</p>
            </div>
          </div>
          <div className="integration-ribbon" aria-label="Integrated products">
            <a href="https://world.org/" rel="noreferrer" target="_blank">
              <BrandLogo brand="world" />
              <span><b>World</b><small>Identity</small></span>
            </a>
            <a href="https://1inch.io/" rel="noreferrer" target="_blank">
              <BrandLogo brand="oneinch" />
              <span><b>1inch</b><small>Aqua + SwapVM</small></span>
            </a>
            <a href="https://thegraph.com/" rel="noreferrer" target="_blank">
              <BrandLogo brand="thegraph" />
              <span><b>The Graph</b><small>Nuthatch indexer</small></span>
            </a>
          </div>
        </div>
        <div className="market-price">
          <span>Verified executable quote</span>
          <strong>{humanPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          <small>tUSD / tETH</small>
          <em>+{identityEdgeBps} BPS IDENTITY EDGE</em>
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
      </section>

      <details className="deployment-details">
        <summary>
          <span>
            <i className="deployment-status" />
            {isSnapshot
              ? 'Recorded market snapshot'
              : `World Chain ${state.runtime.chainId} · ${state.stats.totalSwaps} settled fills · RPC live`}
          </span>
          <span>Inspect contracts +</span>
        </summary>
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
