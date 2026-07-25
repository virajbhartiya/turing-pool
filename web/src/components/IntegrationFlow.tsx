import { shortAddress } from '../lib/format';
import type { DemoTradeResult, ProtocolState } from '../types';

interface IntegrationFlowProps {
  state: ProtocolState;
  lastTrade?: DemoTradeResult;
}

export function IntegrationFlow({ state, lastTrade }: IntegrationFlowProps) {
  const activity = state.dataSources.activity;
  const nuthatchConnected =
    activity.name.toLowerCase().includes('nuthatch') && activity.status === 'connected';
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
      ? 'Nuthatch offline · chain fallback'
      : 'Chain fallback active';

  return (
    <section className="integration-flow" aria-label="Live sponsor integration flow">
      <div className="integration-intro">
        <span>One executable loop</span>
        <strong>Three systems, one receipt.</strong>
        <p>Identity selects risk, SwapVM settles it through Aqua, and Nuthatch makes the activity queryable.</p>
      </div>
      <div className="integration-step world">
        <div><span>01 · WORLD</span><i aria-hidden="true" className="status-dot" /></div>
        <strong>AgentBook resolves the taker</strong>
        <p>
          {lastTrade
            ? lastTrade.humanBacked
              ? `humanId ${lastTrade.humanId.slice(0, 10)}…`
              : 'anonymous wallet · humanId 0'
            : `${shortAddress(state.execution?.humanWallet ?? '')} is human-backed`}
        </p>
        <small>canonical on-chain lookup</small>
      </div>
      <div className="flow-arrow" aria-hidden="true">→</div>
      <div className="integration-step swapvm">
        <div><span>02 · 1INCH</span><i aria-hidden="true" className="status-dot" /></div>
        <strong>Aqua + SwapVM execute</strong>
        <p>
          {lastTrade
            ? `block ${lastTrade.blockNumber} · ${lastTrade.feeBps} bps`
            : `router ${shortAddress(state.contracts.router)} · opcode ${state.execution?.opcode ?? 34}`}
        </p>
        <small>real contracts · demo assets</small>
      </div>
      <div className="flow-arrow" aria-hidden="true">→</div>
      <div className={`integration-step nuthatch ${nuthatchConnected ? 'connected' : 'waiting'}`}>
        <div><span>03 · THE GRAPH</span><i aria-hidden="true" className="status-dot" /></div>
        <strong>Nuthatch indexes activity</strong>
        <p>{indexLabel}</p>
        <small>
          {nuthatchConnected
            ? `SQL + MCP · ${activity.lagBlocks ?? 0} block lag`
            : activity.error ?? 'direct event reads preserve the demo'}
        </small>
      </div>
    </section>
  );
}
