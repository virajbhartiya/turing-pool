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
  DemoTradeProgress,
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

function isDemoTradeProgress(value: unknown): value is DemoTradeProgress {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DemoTradeProgress>;
  return (
    typeof candidate.stage === 'string' &&
    (candidate.status === 'active' || candidate.status === 'complete') &&
    typeof candidate.title === 'string' &&
    typeof candidate.detail === 'string'
  );
}

function upsertProgress(
  current: DemoTradeProgress[],
  next: DemoTradeProgress,
): DemoTradeProgress[] {
  const existing = current.findIndex((item) => item.stage === next.stage);
  if (existing === -1) return [...current, next];
  return current.map((item, index) => (index === existing ? next : item));
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
  const [tradeProgress, setTradeProgress] = useState<DemoTradeProgress[]>([]);
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
    setTradeProgress([
      {
        stage: 'wallet',
        status: 'active',
        title: 'Connect execution service',
        detail: 'Opening a live trace for this on-chain trade',
      },
    ]);
    try {
      const response = await fetch(`${apiBase()}/demo/trade`, {
        method: 'POST',
        headers: {
          accept: 'application/x-ndjson',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ lane, amountIn, direction: tradeDirection }),
      });
      if (!response.ok || !response.body) {
        const body: unknown = await response.json();
        const safeError: DemoTradeError = isDemoTradeError(body)
          ? body
          : {
              code: 'trade_failed',
              error:
                'The trade service returned an unexpected response. Check on-chain activity before retrying.',
              retryable: false,
              status: response.status,
            };
        setTradeError(safeError);
        setTradeProgress((current) =>
          current.map((item) =>
            item.status === 'active' ? { ...item, status: 'error' } : item,
          ),
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      let result: DemoTradeResult | undefined;
      let streamedError: DemoTradeError | undefined;

      const consumeLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as {
          type?: unknown;
          progress?: unknown;
          result?: unknown;
          error?: unknown;
        };
        const progress = event.progress;
        if (event.type === 'progress' && isDemoTradeProgress(progress)) {
          setTradeProgress((current) => upsertProgress(current, progress));
        } else if (event.type === 'result' && isDemoTradeResult(event.result)) {
          result = event.result;
        } else if (event.type === 'error' && isDemoTradeError(event.error)) {
          streamedError = event.error;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffered += decoder.decode(value, { stream: !done });
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) consumeLine(line);
        if (done) break;
      }
      consumeLine(buffered);

      if (streamedError) {
        setTradeError(streamedError);
        setTradeProgress((current) =>
          current.map((item) =>
            item.status === 'active' ? { ...item, status: 'error' } : item,
          ),
        );
        return;
      }
      if (!result) {
        throw new Error('trade stream ended without a mined result');
      }

      setLastTrade(result);
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'refresh',
          status: 'active',
          title: 'Refresh market state',
          detail: 'Loading the new quote pair, LP economics, and indexed activity',
        }),
      );
      await refresh();
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'refresh',
          status: 'complete',
          title: 'Terminal synchronized',
          detail: 'Chart, receipts, LP revenue, and next executable rates are refreshed',
        }),
      );
    } catch {
      setTradeError({
        code: 'network_error',
        error:
          'The trading service could not be reached. No transaction confirmation was received.',
        retryable: true,
        retryAfterSeconds: 5,
        status: 0,
      });
      setTradeProgress((current) =>
        current.map((item) =>
          item.status === 'active' ? { ...item, status: 'error' } : item,
        ),
      );
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
        tradeProgress={tradeProgress}
        lastTrade={lastTrade}
        amountIn={amountIn}
        onAmountChange={setAmountIn}
        direction={direction}
        onDirectionChange={selectDirection}
      >
        <LPEconomicsPanel
          state={state}
          token0PriceInToken1={token0PriceInToken1}
          activeFeeSchedule={quotes.feeSchedule}
          activeTokenInSymbol={quotes.tokenInSymbol}
        />
      </TradingTerminal>
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
