import { useEffect, useState } from 'react';

import { formatUnits, shortAddress } from '../lib/format';
import type {
  DemoQuote,
  DemoQuotes,
  DemoTradeDirection,
  DemoTradeError,
  DemoTradeLane,
  DemoTradeProgress,
  DemoTradeResult,
  ProtocolState,
} from '../types';
import { FeeChart } from './FeeChart';

type Lane = 'human' | 'bot';

function QuoteCard({
  lane,
  quote,
  improvement,
  tokenInSymbol,
  tokenOutSymbol,
}: {
  lane: Lane;
  quote: DemoQuote;
  improvement?: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
}) {
  const human = lane === 'human';
  const precision = tokenOutSymbol === 'tETH' ? 6 : 2;

  return (
    <article className={`quote-card ${human ? 'human' : 'bot'}`}>
      <div className="quote-card-head">
        <span><i />{human ? 'Human-backed agent' : 'Anonymous bot'}</span>
        <b>{quote.tier.toUpperCase()} LANE</b>
      </div>
      <strong>{formatUnits(quote.amountOut, 18, precision)}<small>{tokenOutSymbol}</small></strong>
      <p>{human ? 'World AgentBook resolved · shared risk budget' : 'No human ID · repeat-wallet risk'}</p>
      <div className="quote-card-foot">
        <span>{formatUnits(quote.amountIn)} {tokenInSymbol} in</span>
        <b>{quote.feeBps} bps</b>
      </div>
      {improvement && <em>{improvement}</em>}
    </article>
  );
}

interface TradingTerminalProps {
  state: ProtocolState;
  quotes: DemoQuotes;
  onReplay: () => void;
  onTrade: (
    lane: DemoTradeLane,
    amountIn: string,
    direction: DemoTradeDirection,
  ) => Promise<void>;
  tradeLane?: DemoTradeLane;
  tradeError?: DemoTradeError;
  tradeProgress: DemoTradeProgress[];
  lastTrade?: DemoTradeResult;
  amountIn: string;
  onAmountChange: (amountIn: string) => void;
  direction: DemoTradeDirection;
  onDirectionChange: (direction: DemoTradeDirection) => void;
}

const TRADE_SIZES = {
  'tETH-to-tUSD': [
    { label: '0.1', amountIn: '100000000000000000' },
    { label: '0.5', amountIn: '500000000000000000' },
    { label: '1.0', amountIn: '1000000000000000000' },
  ],
  'tUSD-to-tETH': [
    { label: '100', amountIn: '100000000000000000000' },
    { label: '500', amountIn: '500000000000000000000' },
    { label: '1,000', amountIn: '1000000000000000000000' },
  ],
} as const satisfies Record<
  DemoTradeDirection,
  ReadonlyArray<{ label: string; amountIn: string }>
>;

function tradeErrorHeadline(error: DemoTradeError): string {
  if (error.code === 'rpc_rate_limited') return 'Network busy · no trade sent';
  if (error.code === 'trade_busy') return 'Trade already processing';
  if (error.code === 'execution_unavailable') return 'Execution unavailable';
  if (error.code === 'network_error') return 'Network unavailable · status unknown';
  return 'Trade not completed';
}

function ExecutionTrace({
  lane,
  pending,
  progress,
}: {
  lane: Lane;
  pending: boolean;
  progress: DemoTradeProgress[];
}) {
  if (progress.length === 0) return null;

  const failed = progress.some((step) => step.status === 'error');
  const status = failed ? 'STOPPED' : pending ? 'EXECUTING' : 'CONFIRMED';

  return (
    <section className={`execution-trace ${lane}`} aria-live="polite">
      <header>
        <div>
          <span>Live execution trace</span>
          <small>Backend and chain events only</small>
        </div>
        <b className={failed ? 'failed' : undefined}>{status}</b>
      </header>
      <ol>
        {progress.map((step, index) => (
          <li className={step.status} key={step.stage}>
            <i aria-hidden="true">
              {step.status === 'complete'
                ? '✓'
                : step.status === 'error'
                  ? '!'
                  : String(index + 1).padStart(2, '0')}
            </i>
            <div>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TradingTerminal({
  state,
  quotes,
  onReplay,
  onTrade,
  tradeLane,
  tradeError,
  tradeProgress,
  lastTrade,
  amountIn,
  onAmountChange,
  direction,
  onDirectionChange,
}: TradingTerminalProps) {
  const initialLane =
    new URLSearchParams(window.location.search).get('account') === 'bot' ? 'bot' : 'human';
  const [lane, setLane] = useState<Lane>(initialLane);
  const selected = quotes[lane];
  const outputDelta = BigInt(quotes.human.amountOut) - BigInt(quotes.bot.amountOut);
  const tokenInSymbol = quotes.tokenInSymbol ?? (direction === 'tETH-to-tUSD' ? 'tETH' : 'tUSD');
  const tokenOutSymbol = quotes.tokenOutSymbol ?? (direction === 'tETH-to-tUSD' ? 'tUSD' : 'tETH');
  const deltaLabel = formatUnits(outputDelta, 18, tokenOutSymbol === 'tETH' ? 6 : 2);
  const sybilOverage = BigInt(quotes.sybil.amountIn) - BigInt(quotes.sybil.sharedQuotaRemaining);
  const executionEnabled = state.execution?.enabled === true;
  const submitting = tradeLane !== undefined;
  const selectedTradePending = tradeLane === lane;
  const quoteReady = selected.amountIn === amountIn;
  const wallet =
    lane === 'human' ? state.execution?.humanWallet : state.execution?.botWallet;
  const companionLane: Lane = lane === 'human' ? 'bot' : 'human';
  const companionUrl = new URL(window.location.href);
  companionUrl.searchParams.set('account', companionLane);

  useEffect(() => {
    document.title = `${lane === 'human' ? 'HUMAN' : 'BOT'} · Turing Pool`;
  }, [lane]);

  function selectLane(nextLane: Lane) {
    setLane(nextLane);
    const url = new URL(window.location.href);
    url.searchParams.set('account', nextLane);
    window.history.replaceState({}, '', url);
  }

  return (
    <section className="trading-workspace" id="activity">
      <div className="terminal-panel execution-panel">
        <div className="panel-head">
          <div>
            <strong>Fee market · realized order flow</strong>
            <span>Same pool and order size · only the on-chain identity result changes</span>
          </div>
          <div className="chart-controls" aria-label="Chart interval"><span>1H</span><span className="active">ALL</span></div>
        </div>
        <FeeChart controller={state.feeController} swaps={state.swaps} />
        <div className="quote-comparison">
          <QuoteCard
            lane="bot"
            quote={quotes.bot}
            tokenInSymbol={tokenInSymbol}
            tokenOutSymbol={tokenOutSymbol}
          />
          <QuoteCard
            lane="human"
            quote={quotes.human}
            improvement={`+${deltaLabel} ${tokenOutSymbol} on identical size`}
            tokenInSymbol={tokenInSymbol}
            tokenOutSymbol={tokenOutSymbol}
          />
        </div>
        <div className="comparison-tape">
          <strong>Verified execution edge <b>+{deltaLabel} {tokenOutSymbol}</b></strong>
          <span>{quotes.human.feeBps} bps human / {quotes.bot.feeBps} bps bot · both move with mined volume</span>
        </div>
      </div>

      <aside className="terminal-panel quote-ticket" aria-label="Quote ticket">
        <div className="panel-head">
          <div><strong>Quote ticket</strong><span>Exact input · live on-chain execution</span></div>
          <span className="live-tag">LIVE</span>
        </div>
        <div className="ticket-tabs" aria-label="Order-flow identity">
          {(['human', 'bot'] as const).map((tabLane) => (
            <button
              aria-pressed={lane === tabLane}
              className={lane === tabLane ? 'active' : undefined}
              data-lane={tabLane}
              key={tabLane}
              onClick={() => selectLane(tabLane)}
              type="button"
            >
              {tabLane === 'human' ? 'Human verified' : 'Bot account'}
            </button>
          ))}
        </div>
        <div className="ticket-body">
          <div className={`account-context ${lane}`}>
            <div>
              <span>Active demo signer</span>
              <strong>{lane === 'human' ? 'World-verified agent' : 'Anonymous bot'}</strong>
            </div>
            <code>{shortAddress(wallet)}</code>
            <small>
              {lane === 'human'
                ? `AgentBook humanId ${state.demoHuman.humanId.slice(0, 10)}… · shared quota applies`
                : 'AgentBook returned humanId 0 · wide risk lane applies'}
            </small>
            <a href={companionUrl.toString()} rel="noreferrer" target="_blank">
              Open {companionLane === 'human' ? 'human' : 'bot'} trader tab ↗
            </a>
          </div>
          <div className="direction-tabs" aria-label="Trade direction">
            <button
              aria-pressed={direction === 'tUSD-to-tETH'}
              className={direction === 'tUSD-to-tETH' ? 'active' : undefined}
              disabled={submitting}
              onClick={() => onDirectionChange('tUSD-to-tETH')}
              type="button"
            >
              Buy tETH
              <small>Pay tUSD</small>
            </button>
            <button
              aria-pressed={direction === 'tETH-to-tUSD'}
              className={direction === 'tETH-to-tUSD' ? 'active' : undefined}
              disabled={submitting}
              onClick={() => onDirectionChange('tETH-to-tUSD')}
              type="button"
            >
              Sell tETH
              <small>Receive tUSD</small>
            </button>
          </div>
          <div className="size-selector">
            <span>Trade size · {tokenInSymbol} input · volume drives repricing</span>
            <div>
              {TRADE_SIZES[direction].map((size) => (
                <button
                  aria-pressed={amountIn === size.amountIn}
                  className={amountIn === size.amountIn ? 'active' : undefined}
                  disabled={submitting}
                  key={size.amountIn}
                  onClick={() => onAmountChange(size.amountIn)}
                  type="button"
                >
                  {size.label} {tokenInSymbol}
                </button>
              ))}
            </div>
          </div>
          <div className="token-field">
            <label>Pay <span>Demo balance</span></label>
            <div><strong>{formatUnits(selected.amountIn)}</strong><b>{tokenInSymbol}</b></div>
          </div>
          <div className="swap-arrow">↓</div>
          <div className="token-field">
            <label>Receive <span>On-chain quote</span></label>
            <div>
              <strong>{formatUnits(selected.amountOut, 18, tokenOutSymbol === 'tETH' ? 6 : 2)}</strong>
              <b>{tokenOutSymbol}</b>
            </div>
          </div>
          <dl className="ticket-summary">
            <div><dt>Risk lane</dt><dd>{selected.tier.toUpperCase()} · {lane === 'human' ? 'bounded' : 'unbounded'}</dd></div>
            <div><dt>Live LP rate</dt><dd>{selected.feeBps} bps</dd></div>
            <div><dt>Settlement</dt><dd>Aqua · maker inventory</dd></div>
            <div>
              <dt>Execution edge</dt>
              <dd className={lane === 'human' ? 'positive' : 'negative'}>
                {lane === 'human' ? `+${deltaLabel}` : `−${deltaLabel}`} {tokenOutSymbol}
              </dd>
            </div>
          </dl>
          <button
            className={`trade-action ${lane}`}
            disabled={submitting || !quoteReady}
            onClick={() => {
              if (executionEnabled) void onTrade(lane, selected.amountIn, direction);
              else onReplay();
            }}
            type="button"
          >
            {!quoteReady
              ? 'Refreshing on-chain quote…'
              : selectedTradePending
              ? `Mining ${lane} trade…`
              : executionEnabled
                ? `${direction === 'tUSD-to-tETH' ? 'Buy' : 'Sell'} as ${lane} on-chain`
                : 'Interactive execution unavailable'}
          </button>
          <p className="ticket-note">
            {executionEnabled
              ? `Mined notional updates HumanQuota, repricing the next SwapVM quote through opcode ${state.execution?.opcode}.`
              : 'Live signing is disabled on this runtime.'}
          </p>
          <ExecutionTrace
            lane={tradeLane ?? lane}
            pending={submitting}
            progress={tradeProgress}
          />
          {tradeError && (
            <div className="trade-receipt error" role="alert">
              <b>{tradeErrorHeadline(tradeError)}</b>
              <span>{tradeError.error}</span>
              {tradeError.retryable && tradeError.retryAfterSeconds !== undefined && (
                <small>Retry in about {tradeError.retryAfterSeconds} seconds.</small>
              )}
            </div>
          )}
          {lastTrade && (
            <a className={`trade-receipt ${lastTrade.tight ? 'human' : 'bot'}`} href={lastTrade.explorerUrl} rel="noreferrer" target="_blank">
              <span>Latest mined proof · block {lastTrade.blockNumber} ↗</span>
              <strong>{lastTrade.event} · opcode {lastTrade.opcode}</strong>
              <small>
                {formatUnits(lastTrade.amountIn)} {lastTrade.tokenInSymbol} →{' '}
                {formatUnits(
                  lastTrade.amountOut,
                  18,
                  lastTrade.tokenOutSymbol === 'tETH' ? 6 : 2,
                )}{' '}
                {lastTrade.tokenOutSymbol} · {lastTrade.humanBacked ? 'humanId resolved' : 'no humanId'} ·{' '}
                {lastTrade.tier.toUpperCase()} · {lastTrade.feeBps} bps
              </small>
            </a>
          )}
        </div>
        <div className="sybil-alert">
          <span>Shared identity risk check</span>
          <strong>{quotes.sybil.tier.toUpperCase()}</strong>
          <p>{formatUnits(quotes.sybil.sharedQuotaRemaining)} {tokenInSymbol} shared remaining</p>
          <small>Wallet #2 asks for remaining + {sybilOverage.toString()} wei. A new wallet cannot reset risk.</small>
        </div>
      </aside>
    </section>
  );
}
