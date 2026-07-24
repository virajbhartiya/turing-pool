import { useEffect, useState } from 'react';

import { EvidenceLedger } from './components/EvidenceLedger';
import { FeeControllerPanel } from './components/FeeControllerPanel';
import { MarketHeader } from './components/MarketHeader';
import { ProtocolDetails } from './components/ProtocolDetails';
import { TradingTerminal } from './components/TradingTerminal';
import { apiBase, demoTradeAmountIn, useProtocol } from './hooks/useProtocol';
import type { DemoTradeLane, DemoTradeResult } from './types';

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
  const [amountIn, setAmountIn] = useState(demoTradeAmountIn);
  const { snapshot, error, refreshing, refresh } = useProtocol(amountIn);
  const [copied, setCopied] = useState(false);
  const [tradeLane, setTradeLane] = useState<DemoTradeLane>();
  const [tradeError, setTradeError] = useState<string>();
  const [lastTrade, setLastTrade] = useState<DemoTradeResult>();

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyReplayCommand() {
    try {
      await navigator.clipboard.writeText('pnpm demo:world');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function executeTrade(lane: DemoTradeLane, amountIn: string) {
    setTradeLane(lane);
    setTradeError(undefined);
    try {
      const response = await fetch(`${apiBase()}/demo/trade`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lane, amountIn }),
      });
      const body = (await response.json()) as DemoTradeResult | { error?: string };
      if (!response.ok || !('transactionHash' in body)) {
        throw new Error('error' in body && body.error ? body.error : `trade failed with HTTP ${response.status}`);
      }
      setLastTrade(body);
      await refresh();
    } catch (caught) {
      setTradeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTradeLane(undefined);
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
      <TradingTerminal
        state={state}
        quotes={quotes}
        onReplay={copyReplayCommand}
        onTrade={executeTrade}
        tradeError={tradeError}
        tradeLane={tradeLane}
        lastTrade={lastTrade}
        amountIn={amountIn}
        onAmountChange={setAmountIn}
      />
      <FeeControllerPanel controller={state.feeController} copied={copied} onReplay={copyReplayCommand} />
      <EvidenceLedger state={state} />
      <ProtocolDetails state={state} />
      <footer>
        <span>Turing Pool · ETHGlobal Lisbon</span>
        <p>
          {isSnapshot
            ? 'Hosted deterministic preview · no live RPC or executable liquidity'
            : `${state.runtime.label} · Aqua + SwapVM settlement · maker-owned demo assets`}
        </p>
      </footer>
    </main>
  );
}
