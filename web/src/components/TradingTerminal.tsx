import { useState } from 'react';

import { formatUnits } from '../lib/format';
import type {
  DemoQuote,
  DemoQuotes,
  DemoTradeLane,
  DemoTradeResult,
  ProtocolState,
} from '../types';
import { FeeChart } from './FeeChart';

type Lane = 'human' | 'bot';

function QuoteCard({ lane, quote, improvement }: { lane: Lane; quote: DemoQuote; improvement?: string }) {
  const human = lane === 'human';

  return (
    <article className={`quote-card ${human ? 'human' : 'bot'}`}>
      <div className="quote-card-head">
        <span><i />{human ? 'Human-backed agent' : 'Anonymous bot'}</span>
        <b>{quote.tier.toUpperCase()} LANE</b>
      </div>
      <strong>{formatUnits(quote.amountOut)}<small>tUSD</small></strong>
      <p>{human ? 'World AgentBook resolved · shared risk budget' : 'No human ID · repeat-wallet risk'}</p>
      <div className="quote-card-foot">
        <span>{formatUnits(quote.amountIn)} tETH in</span>
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
  onTrade: (lane: DemoTradeLane, amountIn: string) => Promise<void>;
  tradeLane?: DemoTradeLane;
  tradeError?: string;
  lastTrade?: DemoTradeResult;
  amountIn: string;
  onAmountChange: (amountIn: string) => void;
}

const TRADE_SIZES = [
  { label: '0.1', amountIn: '100000000000000000' },
  { label: '0.5', amountIn: '500000000000000000' },
  { label: '1.0', amountIn: '1000000000000000000' },
] as const;

export function TradingTerminal({
  state,
  quotes,
  onReplay,
  onTrade,
  tradeLane,
  tradeError,
  lastTrade,
  amountIn,
  onAmountChange,
}: TradingTerminalProps) {
  const [lane, setLane] = useState<Lane>('human');
  const selected = quotes[lane];
  const outputDelta = BigInt(quotes.human.amountOut) - BigInt(quotes.bot.amountOut);
  const deltaLabel = formatUnits(outputDelta);
  const sybilOverage = BigInt(quotes.sybil.amountIn) - BigInt(quotes.sybil.sharedQuotaRemaining);
  const executionEnabled = state.execution?.enabled === true;
  const submitting = tradeLane !== undefined;
  const selectedTradePending = tradeLane === lane;
  const quoteReady = selected.amountIn === amountIn;

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
          <QuoteCard lane="bot" quote={quotes.bot} />
          <QuoteCard lane="human" quote={quotes.human} improvement={`+${deltaLabel} tUSD on identical size`} />
        </div>
        <div className="comparison-tape">
          <strong>Verified execution edge <b>+{deltaLabel} tUSD</b></strong>
          <span>{quotes.human.feeBps} bps retail vs {quotes.bot.feeBps} bps bot · LP target unchanged</span>
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
              onClick={() => setLane(tabLane)}
              type="button"
            >
              {tabLane === 'human' ? 'Verified agent' : 'Anonymous'}
            </button>
          ))}
        </div>
        <div className="ticket-body">
          <div className="size-selector">
            <span>Trade size · volume drives repricing</span>
            <div>
              {TRADE_SIZES.map((size) => (
                <button
                  aria-pressed={amountIn === size.amountIn}
                  className={amountIn === size.amountIn ? 'active' : undefined}
                  disabled={submitting}
                  key={size.amountIn}
                  onClick={() => onAmountChange(size.amountIn)}
                  type="button"
                >
                  {size.label} tETH
                </button>
              ))}
            </div>
          </div>
          <div className="token-field">
            <label>Pay <span>Demo balance</span></label>
            <div><strong>{formatUnits(selected.amountIn)}</strong><b>tETH</b></div>
          </div>
          <div className="swap-arrow">↓</div>
          <div className="token-field">
            <label>Receive <span>On-chain quote</span></label>
            <div><strong>{formatUnits(selected.amountOut)}</strong><b>tUSD</b></div>
          </div>
          <dl className="ticket-summary">
            <div><dt>Risk lane</dt><dd>{selected.tier.toUpperCase()} · {lane === 'human' ? 'bounded' : 'unbounded'}</dd></div>
            <div><dt>LP fee</dt><dd>{selected.feeBps} bps</dd></div>
            <div><dt>Settlement</dt><dd>Aqua · maker inventory</dd></div>
            <div><dt>Execution edge</dt><dd className={lane === 'human' ? 'positive' : 'negative'}>{lane === 'human' ? `+${deltaLabel}` : `−${deltaLabel}`} tUSD</dd></div>
          </dl>
          <button
            className={`trade-action ${lane}`}
            disabled={submitting || !quoteReady}
            onClick={() => {
              if (executionEnabled) void onTrade(lane, selected.amountIn);
              else onReplay();
            }}
            type="button"
          >
            {!quoteReady
              ? 'Refreshing on-chain quote…'
              : selectedTradePending
              ? `Mining ${lane} trade…`
              : executionEnabled
                ? `Execute ${lane} wallet on-chain`
                : 'Interactive execution unavailable'}
          </button>
          <p className="ticket-note">
            {executionEnabled
              ? `Mined notional updates HumanQuota, repricing the next SwapVM quote through opcode ${state.execution?.opcode}.`
              : 'Live signing is disabled on this runtime.'}
          </p>
          {tradeError && <div className="trade-receipt error"><b>Trade rejected</b><span>{tradeError}</span></div>}
          {lastTrade && (
            <a className={`trade-receipt ${lastTrade.tight ? 'human' : 'bot'}`} href={lastTrade.explorerUrl} rel="noreferrer" target="_blank">
              <span>Latest mined proof · block {lastTrade.blockNumber} ↗</span>
              <strong>{lastTrade.event} · opcode {lastTrade.opcode}</strong>
              <small>
                {lastTrade.humanBacked ? 'humanId resolved' : 'no humanId'} · {lastTrade.tier.toUpperCase()} · {lastTrade.feeBps} bps
              </small>
            </a>
          )}
        </div>
        <div className="sybil-alert">
          <span>Shared identity risk check</span>
          <strong>{quotes.sybil.tier.toUpperCase()}</strong>
          <p>{formatUnits(quotes.sybil.sharedQuotaRemaining)} tETH shared remaining</p>
          <small>Wallet #2 asks for remaining + {sybilOverage.toString()} wei. A new wallet cannot reset risk.</small>
        </div>
      </aside>
    </section>
  );
}
