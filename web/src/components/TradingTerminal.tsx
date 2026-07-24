import { useState } from 'react';

import { formatUnits } from '../lib/format';
import type { DemoQuote, DemoQuotes, ProtocolState } from '../types';
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
      <p>{human ? 'AgentKit verified · shared risk budget' : 'No identity proof · repeat-wallet risk'}</p>
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
}

export function TradingTerminal({ state, quotes, onReplay }: TradingTerminalProps) {
  const [lane, setLane] = useState<Lane>('human');
  const selected = quotes[lane];
  const outputDelta = BigInt(quotes.human.amountOut) - BigInt(quotes.bot.amountOut);
  const deltaLabel = formatUnits(outputDelta);
  const sybilOverage = BigInt(quotes.sybil.amountIn) - BigInt(quotes.sybil.sharedQuotaRemaining);

  return (
    <section className="trading-workspace" id="activity">
      <div className="terminal-panel execution-panel">
        <div className="panel-head">
          <div>
            <strong>Fee market · realized order flow</strong>
            <span>Same pool, same size, same block · only the risk proof changes</span>
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
          <div><strong>Quote ticket</strong><span>Exact input · on-chain simulation</span></div>
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
          <button className={`trade-action ${lane}`} onClick={onReplay} type="button">Replay testnet execution</button>
          <p className="ticket-note">Copies the deterministic Base Sepolia demo command.</p>
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
