import { formatUnits, shortAddress } from '../lib/format';
import type { ProtocolState } from '../types';

export function ProtocolDetails({ state }: { state: ProtocolState }) {
  const cap = BigInt(state.demoHuman.dailyCapToken0);
  const remaining = BigInt(state.demoHuman.quotaRemainingToken0);
  const used = cap > remaining ? cap - remaining : 0n;
  const usedPercent = cap > 0n ? Number((used * 100n) / cap) : 0;
  const indexer = state.dataSources.activity;

  return (
    <details className="protocol-section protocol-disclosure">
      <summary>
        <span>
          <b>Protocol state</b>
        </span>
        <em>Inspect +</em>
      </summary>
      <div className="protocol-grid">
        <article>
          <span>Active fee schedule</span>
          <strong>{state.pool.tightFeeBps}<small> / </small>{state.pool.wideFeeBps}<em>bps</em></strong>
          <p>verified retail / HFT + arbitrage</p>
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
          <span>On-chain volume controller</span>
          <div className="strategy-log">
            <div>
              <time>{formatUnits(state.feeController.tightVolume)} tETH verified</time>
              <p>{formatUnits(state.feeController.wideVolume)} tETH HFT / arb · input notional</p>
            </div>
            <div>
              <time>{state.feeController.targetFeeBps} bps LP target</time>
              <p>balanced next rates {state.feeController.tightFeeBps}/{state.feeController.wideFeeBps} bps</p>
            </div>
          </div>
        </article>
        <article className="source-card">
          <span>Data provenance</span>
          <dl>
            <div><dt>Quotes</dt><dd>{state.dataSources.quotes.name}</dd></div>
            <div><dt>Strategy</dt><dd>{state.dataSources.strategy.name}</dd></div>
            <div><dt>Controller</dt><dd>HumanQuota · on-chain volume</dd></div>
            <div><dt>Indexer</dt><dd>{indexer.name} · {indexer.status}</dd></div>
            {indexer.indexedBlock && <div><dt>Indexed</dt><dd>block {indexer.indexedBlock}</dd></div>}
            <div><dt>Router</dt><dd>{shortAddress(state.contracts.router)}</dd></div>
          </dl>
        </article>
      </div>
    </details>
  );
}
