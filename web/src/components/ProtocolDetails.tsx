import { formatUnits, shortAddress } from '../lib/format';
import type { ProtocolState } from '../types';

export function ProtocolDetails({ state }: { state: ProtocolState }) {
  const cap = BigInt(state.demoHuman.dailyCapToken0);
  const remaining = BigInt(state.demoHuman.quotaRemainingToken0);
  const used = cap > remaining ? cap - remaining : 0n;
  const usedPercent = cap > 0n ? Number((used * 100n) / cap) : 0;
  const graph = state.dataSources.strategist;

  return (
    <section className="protocol-section">
      <div className="section-head">
        <div><span>Protocol state</span><h2>Liquidity and risk controls</h2></div>
        <p>Live Aqua events, quota accounting, and immutable strategy parameters</p>
      </div>
      <div className="protocol-grid">
        <article>
          <span>Active fee schedule</span>
          <strong>{state.pool.tightFeeBps}<small> / </small>{state.pool.wideFeeBps}<em>bps</em></strong>
          <p>human-backed / anonymous</p>
          <code>{shortAddress(state.pool.strategyHash)}</code>
        </article>
        <article>
          <span>Virtual Aqua inventory</span>
          <strong>{formatUnits(state.pool.balance0, 18, 1)}<em>tETH</em></strong>
          <strong className="secondary">{formatUnits(state.pool.balance1, 18, 0)}<em>tUSD</em></strong>
          <p>maker-owned demo liquidity</p>
        </article>
        <article>
          <span>Shared human quota</span>
          <strong>{formatUnits(remaining)}<em>tETH left</em></strong>
          <div className="quota-track"><i style={{ width: `${usedPercent}%` }} /></div>
          <p>{formatUnits(used)} used / {formatUnits(cap)} daily cap</p>
        </article>
        <article className="history-card">
          <span>Strategist history</span>
          <div className="strategy-log">
            {state.strategyHistory.slice().reverse().map((entry) => (
              <div key={`${entry.blockNumber}-${entry.strategyHash}`}>
                <time>block {entry.blockNumber}</time>
                <p>
                  {entry.kind === 'initial-ship'
                    ? `initial strategy ${entry.to.tightFeeBps}/${entry.to.wideFeeBps} bps`
                    : `re-priced ${entry.from?.tightFeeBps}/${entry.from?.wideFeeBps} → ${entry.to.tightFeeBps}/${entry.to.wideFeeBps} bps`}
                </p>
              </div>
            ))}
          </div>
        </article>
        <article className="source-card">
          <span>Data provenance</span>
          <dl>
            <div><dt>Quotes</dt><dd>{state.dataSources.quotes.name}</dd></div>
            <div><dt>Strategy</dt><dd>{state.dataSources.strategy.name}</dd></div>
            <div><dt>Controller</dt><dd>{graph.name} · {graph.status}</dd></div>
            <div><dt>Router</dt><dd>{shortAddress(state.contracts.router)}</dd></div>
          </dl>
        </article>
      </div>
    </section>
  );
}
