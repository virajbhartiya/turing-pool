import { useEffect, useState } from 'react';

import { EvidenceLedger } from './components/EvidenceLedger';
import { FeeControllerPanel } from './components/FeeControllerPanel';
import { MarketHeader } from './components/MarketHeader';
import { ProtocolDetails } from './components/ProtocolDetails';
import { TradingTerminal } from './components/TradingTerminal';
import { useProtocol } from './hooks/useProtocol';

function LoadingTerminal() {
  return (
    <div className="loading-terminal" role="status">
      <span />
      <strong>Connecting to the Turing Pool market…</strong>
      <small>Reading live strategy, quote, and activity state</small>
    </div>
  );
}

export function App() {
  const { snapshot, error, refreshing } = useProtocol();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyReplayCommand() {
    try {
      await navigator.clipboard.writeText('pnpm demo:sepolia');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!snapshot) {
    return (
      <main className="app-shell">
        {error && <div className="error-banner">Connection error · {error}</div>}
        <LoadingTerminal />
      </main>
    );
  }

  const { state, quotes } = snapshot;
  const isSnapshot = state.runtime.mode === 'hosted-preview';

  return (
    <main className="app-shell">
      {error && <div className="error-banner">Last refresh failed · {error}</div>}
      <MarketHeader state={state} quotes={quotes} refreshing={refreshing} />
      <TradingTerminal state={state} quotes={quotes} onReplay={copyReplayCommand} />
      <FeeControllerPanel controller={state.feeController} copied={copied} onReplay={copyReplayCommand} />
      <EvidenceLedger state={state} />
      <ProtocolDetails state={state} />
      <footer>
        <span>Turing Pool · ETHGlobal Lisbon</span>
        <p>
          {isSnapshot
            ? 'Hosted deterministic preview · no live RPC or executable liquidity'
            : `${state.runtime.label} · Aqua test deployment · test AgentBook · maker-owned demo liquidity`}
        </p>
      </footer>
    </main>
  );
}
