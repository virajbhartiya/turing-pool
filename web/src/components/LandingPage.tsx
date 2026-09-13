import { formatUnits } from '../lib/format';
import type { ProtocolState } from '../types';
import type { DexView } from './DexHeader';
import { FeeChart } from './FeeChart';
import { ActivityTable } from './ActivityTable';

export function LandingPage({ state, onNavigate }: { state: ProtocolState; onNavigate: (view: DexView) => void }) {
  const controller = state.feeController;
  return (
    <section className="overview-page">
      <header className="page-heading"><div><span className="eyebrow">Your workspace</span><h1>Market overview</h1><p>A clear view of rates, liquidity, and activity.</p></div><button className="button-primary" onClick={() => onNavigate('trade')} type="button">Make a swap <span>↗</span></button></header>
      <div className="overview-metrics">
        <article className="metric-card"><span>Verified trading fee</span><strong>{(controller.tightFeeBps / 100).toFixed(2)}<small>%</small></strong><p><i className="status-dot" />With World ID, within your quota</p></article>
        <article className="metric-card"><span>Standard trading fee</span><strong>{(controller.wideFeeBps / 100).toFixed(2)}<small>%</small></strong><p>Available to every wallet</p></article>
        <article className="metric-card"><span>Pool liquidity</span><strong>{formatUnits(state.pool.balance0, 18, 3)}<small>tETH</small></strong><p>+ {formatUnits(state.pool.balance1, 18, 2)} tUSD in the pool</p></article>
      </div>
      <div className="overview-grid">
        <article className="surface overview-chart">
          <header className="card-heading"><div><h2>tETH / tUSD</h2><p>Execution price · recent confirmed trades</p></div><span className="quiet-badge">Market</span></header>
          <FeeChart controller={controller} feeHistory={state.feeHistory ?? []} pool={state.pool} swaps={state.swaps} mode="price" tokenIn={state.pool.token0} />
        </article>
        <article className="strategy-intro">
          <span className="intro-icon" aria-hidden="true">↗</span><span className="eyebrow">Trade with a plan</span><h2>Your goals.<br />Your conditions.</h2>
          <p>Split a trade into smaller steps. Set your limits, review live conditions, and approve each transaction.</p>
          <button onClick={() => onNavigate('autopilot')} type="button">Create a strategy <span>→</span></button>
          <small>Funds stay in your wallet until you trade.</small>
        </article>
      </div>
      <article className="surface activity-surface"><header className="card-heading"><div><h2>Recent activity</h2><p>Confirmed trades across the market</p></div><button className="text-button" onClick={() => onNavigate('protocol')} type="button">View all activity →</button></header><ActivityTable state={state} limit={5} /></article>
    </section>
  );
}
