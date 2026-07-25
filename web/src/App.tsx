import { useEffect, useState } from 'react';

import { EvidenceLedger } from './components/EvidenceLedger';
import { FeeControllerPanel } from './components/FeeControllerPanel';
import { IntegrationFlow } from './components/IntegrationFlow';
import { LPEconomicsPanel } from './components/LPEconomicsPanel';
import { MarketHeader } from './components/MarketHeader';
import { ProtocolDetails } from './components/ProtocolDetails';
import { TradingTerminal } from './components/TradingTerminal';
import { apiBase, demoTradeAmounts, useProtocol } from './hooks/useProtocol';
import { unitsAsNumber } from './lib/format';
import type {
  DemoTradeDirection,
  DemoTradeError,
  DemoTradeLane,
  DemoTradeResult,
} from './types';

function LoadingTerminal() {
  return (
    <div className="loading-terminal" role="status">
      <span />
      <strong>Connecting to the Turing Pool market…</strong>
      <small>Reading live strategy, quote, and activity state</small>
    </div>
  );
}

function isDemoTradeError(value: unknown): value is DemoTradeError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DemoTradeError>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.error === 'string' &&
    typeof candidate.retryable === 'boolean' &&
    typeof candidate.status === 'number'
  );
}

function isDemoTradeResult(value: unknown): value is DemoTradeResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<DemoTradeResult>).transactionHash === 'string'
  );
}

export function App() {
  const initialDirection: DemoTradeDirection =
    new URLSearchParams(window.location.search).get('side') === 'buy'
      ? 'tUSD-to-tETH'
      : 'tETH-to-tUSD';
  const [direction, setDirection] = useState<DemoTradeDirection>(initialDirection);
  const [amountIn, setAmountIn] = useState(demoTradeAmounts[initialDirection][0]);
  const { snapshot, error, refreshing, refresh } = useProtocol(amountIn, direction);
  const [copied, setCopied] = useState(false);
  const [tradeLane, setTradeLane] = useState<DemoTradeLane>();
  const [tradeError, setTradeError] = useState<DemoTradeError>();
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

  function selectDirection(nextDirection: DemoTradeDirection) {
    setDirection(nextDirection);
    setAmountIn(demoTradeAmounts[nextDirection][0]);
    const url = new URL(window.location.href);
    url.searchParams.set('side', nextDirection === 'tUSD-to-tETH' ? 'buy' : 'sell');
    window.history.replaceState({}, '', url);
  }

  async function executeTrade(
    lane: DemoTradeLane,
    amountIn: string,
    tradeDirection: DemoTradeDirection,
  ) {
    setTradeLane(lane);
    setTradeError(undefined);
    try {
      const response = await fetch(`${apiBase()}/demo/trade`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lane, amountIn, direction: tradeDirection }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isDemoTradeResult(body)) {
        setTradeError(
          isDemoTradeError(body)
            ? body
            : {
                code: 'trade_failed',
                error: 'The trade service returned an unexpected response. Check on-chain activity before retrying.',
                retryable: false,
                status: response.status,
              },
        );
        return;
      }
      setLastTrade(body);
      await refresh();
    } catch {
      setTradeError({
        code: 'network_error',
        error:
          'The trading service could not be reached. No transaction confirmation was received.',
        retryable: true,
        retryAfterSeconds: 5,
        status: 0,
      });
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
  const humanAmountIn = unitsAsNumber(quotes.human.amountIn);
  const humanAmountOut = unitsAsNumber(quotes.human.amountOut);
  const token0PriceInToken1 =
    direction === 'tETH-to-tUSD'
      ? humanAmountOut / humanAmountIn
      : humanAmountIn / humanAmountOut;

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
        direction={direction}
        onDirectionChange={selectDirection}
      />
      <LPEconomicsPanel
        state={state}
        token0PriceInToken1={token0PriceInToken1}
        activeFeeSchedule={quotes.feeSchedule}
        activeTokenInSymbol={quotes.tokenInSymbol}
      />
      <IntegrationFlow state={state} lastTrade={lastTrade} />
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
