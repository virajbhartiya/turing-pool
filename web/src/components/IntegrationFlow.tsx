import { shortAddress } from '../lib/format';
import type { DemoTradeResult, ProtocolState } from '../types';
import { BrandLogo } from './BrandLogo';

interface IntegrationFlowProps {
  state: ProtocolState;
  lastTrade?: DemoTradeResult;
}

export function IntegrationFlow({ state, lastTrade }: IntegrationFlowProps) {
  const activity = state.dataSources.activity;
  const usesNuthatch = activity.mode === 'sql+mcp';
  const nuthatchConnected = usesNuthatch && activity.status === 'connected';
  const receiptIndexed =
    lastTrade !== undefined &&
    state.swaps.some(
      (swap) =>
        swap.transactionHash?.toLowerCase() === lastTrade.transactionHash.toLowerCase(),
    );
  const indexLabel = nuthatchConnected
    ? receiptIndexed
      ? 'Receipt indexed'
      : `Following block ${activity.indexedBlock ?? '—'}`
    : activity.status === 'error'
      ? `${usesNuthatch ? 'Nuthatch' : 'Indexer'} offline · chain fallback`
      : 'Chain fallback active';

  return (
    <section className="integration-section" aria-label="Live integration flow">
      <div className="section-head">
        <div><span>Execution path</span><h2>One trade, three verifiable systems</h2></div>
        <p>Identity → settlement → indexed proof</p>
      </div>
      <div className="integration-flow">
        <div className="integration-step world">
          <div className="integration-brand">
            <BrandLogo brand="world" />
            <span><b>World</b><small>AgentBook</small></span>
            <i aria-hidden="true" className="status-dot" />
          </div>
          <strong>Resolve the trader</strong>
          <p>
            {lastTrade
              ? lastTrade.humanBacked
                ? `humanId ${lastTrade.humanId.slice(0, 10)}…`
                : 'anonymous wallet · humanId 0'
              : `${shortAddress(state.execution?.humanWallet ?? '')} is human-backed`}
          </p>
          <small>Canonical identity lookup on World Chain</small>
        </div>
        <div className="flow-arrow" aria-hidden="true">→</div>
        <div className="integration-step swapvm">
          <div className="integration-brand">
            <BrandLogo brand="oneinch" />
            <span><b>1inch</b><small>Aqua + SwapVM</small></span>
            <i aria-hidden="true" className="status-dot" />
          </div>
          <strong>Price risk and settle</strong>
          <p>
            {lastTrade
              ? `block ${lastTrade.blockNumber} · ${lastTrade.feeBps} bps`
              : `router ${shortAddress(state.contracts.router)} · opcode ${state.execution?.opcode ?? 34}`}
          </p>
          <small>Deployed contracts · maker-owned demo assets</small>
        </div>
        <div className="flow-arrow" aria-hidden="true">→</div>
        <div className={`integration-step nuthatch ${nuthatchConnected ? 'connected' : 'waiting'}`}>
          <div className="integration-brand">
            <BrandLogo brand="nuthatch" />
            <span><b>The Graph</b><small>Nuthatch</small></span>
            <i aria-hidden="true" className="status-dot" />
          </div>
          <strong>Index the receipt</strong>
          <p>{indexLabel}</p>
          <small>
            {nuthatchConnected
              ? `SQL + MCP · ${activity.lagBlocks ?? 0} block lag`
              : activity.error ?? 'Direct event reads preserve the demo'}
          </small>
        </div>
      </div>
    </section>
  );
}
