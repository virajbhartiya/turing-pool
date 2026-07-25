import { shortAddress } from '../lib/format';
import type { DemoTradeResult, ProtocolState } from '../types';
import { BrandLogo } from './BrandLogo';

interface IntegrationFlowProps {
  state: ProtocolState;
  lastTrade?: DemoTradeResult;
}

export function IntegrationFlow({ state, lastTrade }: IntegrationFlowProps) {
  const mirroredIdentity = state.contracts.identityMode === 'world-agentbook-mirror';
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
      : `Synced · ${activity.lagBlocks ?? 0} block lag`
    : activity.status === 'error'
      ? `${usesNuthatch ? 'Nuthatch' : 'Indexer'} offline · chain fallback`
      : 'Chain fallback active';

  return (
    <section className="integration-section" aria-label="Live integration flow">
      <div className="panel-head protocol-panel-head">
        <div><strong>Live execution stack</strong><span>Identity → settlement → indexed proof</span></div>
        <span className="live-tag">OP #34</span>
      </div>
      <div className="integration-flow compact">
        <div className="integration-step world">
          <div className="integration-brand">
            <BrandLogo brand="world" />
            <span><b>World</b><small>{mirroredIdentity ? 'AgentBook → Base mirror' : 'AgentBook'}</small></span>
            <i aria-hidden="true" className="status-dot" />
          </div>
          <p>
            {lastTrade
              ? lastTrade.humanBacked
                ? `humanId ${lastTrade.humanId.slice(0, 10)}…`
                : 'anonymous wallet · humanId 0'
              : `${shortAddress(state.execution?.humanWallet ?? '')} is human-backed`}
          </p>
          <small>{mirroredIdentity ? 'Canonical identity mirrored to Base' : 'Canonical World lookup'}</small>
        </div>
        <div className="flow-arrow" aria-hidden="true">→</div>
        <div className="integration-step swapvm">
          <div className="integration-brand">
            <BrandLogo brand="oneinch" />
            <span><b>1inch</b><small>Aqua + SwapVM</small></span>
            <i aria-hidden="true" className="status-dot" />
          </div>
          <p>
            {lastTrade
              ? `${lastTrade.tier.toUpperCase()} · ${lastTrade.feeBps} bps`
              : `router ${shortAddress(state.contracts.router)} · opcode ${state.execution?.opcode ?? 34}`}
          </p>
          <small>Live Aqua inventory</small>
        </div>
        <div className="flow-arrow" aria-hidden="true">→</div>
        <div className={`integration-step nuthatch ${nuthatchConnected ? 'connected' : 'waiting'}`}>
          <div className="integration-brand">
            <BrandLogo brand="nuthatch" />
            <span><b>The Graph</b><small>Nuthatch</small></span>
            <i aria-hidden="true" className="status-dot" />
          </div>
          <p>{indexLabel}</p>
          <small>{nuthatchConnected ? 'SQL + MCP' : activity.error ?? 'Chain fallback'}</small>
        </div>
      </div>
    </section>
  );
}
