import { useEffect, useState, type ReactNode } from 'react';

import { formatUnits, shortAddress } from '../lib/format';
import type {
  ConnectedWalletQuote,
  DemoQuote,
  DemoQuotes,
  DemoTradeDirection,
  DemoTradeError,
  DemoTradeLane,
  DemoTradeProgress,
  DemoTradeResult,
  ProtocolState,
} from '../types';
import { BrandLogo } from './BrandLogo';
import { FeeChart } from './FeeChart';
import { WorldIdentityControl } from './WorldIdentityControl';

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
      <p>{human ? 'World identity mirrored · shared risk budget' : 'No mirrored human ID · repeat-wallet risk'}</p>
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
  onTrade: (amountIn: string, direction: DemoTradeDirection) => Promise<void>;
  walletInstalled: boolean;
  walletConnecting: boolean;
  connectedAccount?: string;
  connectedAccounts: string[];
  connectedChainId?: number;
  walletQuote?: ConnectedWalletQuote;
  walletQuoteLoading: boolean;
  walletQuoteError?: string;
  onConnectWallet: (requestAccountSelection?: boolean) => Promise<void>;
  onSelectWalletAccount: (account: string) => void;
  onIdentityReady: () => Promise<void>;
  tradeLane?: DemoTradeLane;
  tradeError?: DemoTradeError;
  tradeProgress: DemoTradeProgress[];
  lastTrade?: DemoTradeResult;
  amountIn: string;
  onAmountChange: (amountIn: string) => void;
  direction: DemoTradeDirection;
  onDirectionChange: (direction: DemoTradeDirection) => void;
  children?: ReactNode;
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
  if (error.code === 'insufficient_balance') return 'Insufficient demo asset balance';
  if (error.code === 'wallet_rejected') return 'MetaMask request cancelled';
  if (error.code === 'wallet_unavailable') return 'MetaMask unavailable';
  if (error.code === 'wrong_network') return 'Base Sepolia required';
  if (error.code === 'network_error') return 'Network unavailable · status unknown';
  return 'Trade not completed';
}

const EXECUTION_SERVICES = {
  wallet: { brand: 'turing', label: 'Turing Pool execution service' },
  identity: { brand: 'world', label: 'World → Base mirror' },
  allowance: { brand: 'oneinch', label: '1inch SwapVM router' },
  simulation: { brand: 'oneinch', label: '1inch SwapVM' },
  submission: { brand: 'oneinch', label: 'Base + SwapVM' },
  settlement: { brand: 'oneinch', label: '1inch Aqua settlement' },
  receipt: { brand: 'oneinch', label: 'SwapVM receipt decoder' },
  repricing: { brand: 'turing', label: 'Turing fee controller' },
  refresh: { brand: 'nuthatch', label: 'Nuthatch indexer' },
} as const;

function ExecutionTrace({
  lane,
  pending,
  progress,
}: {
  lane: Lane;
  pending: boolean;
  progress: DemoTradeProgress[];
}) {
  const [expanded, setExpanded] = useState(pending);

  const failed = progress.some((step) => step.status === 'error');
  const complete =
    progress.length > 0 &&
    !pending &&
    !failed &&
    progress.every((step) => step.status === 'complete');

  useEffect(() => {
    if (pending) {
      setExpanded(true);
    } else if (complete) {
      setExpanded(false);
    }
  }, [complete, pending]);

  if (progress.length === 0) return null;

  const status = failed ? 'STOPPED' : pending ? 'EXECUTING' : 'CONFIRMED';
  const currentStep =
    progress.findLast((step) => step.status === 'active') ?? progress.at(-1);
  const currentService = currentStep ? EXECUTION_SERVICES[currentStep.stage] : undefined;
  const milestones = progress.filter((step) =>
    ['identity', 'simulation', 'settlement', 'refresh'].includes(step.stage),
  );
  const visibleProgress = expanded
    ? progress
    : pending || failed
      ? progress.slice(-3)
      : milestones.length > 0
        ? milestones
        : progress.slice(-3);

  return (
    <section className={`execution-trace ${lane}`} aria-live="polite">
      <header>
        <div>
          <span>Live execution trace</span>
          <small>
            {pending && currentService
              ? `Using ${currentService.label}`
              : 'Backend and chain events only'}
          </small>
        </div>
        <div className="trace-actions">
          <b className={failed ? 'failed' : undefined}>{status}</b>
          <button
            aria-controls="execution-trace-steps"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? 'Condense' : `Show all ${progress.length} steps`}
          </button>
        </div>
      </header>
      <ol id="execution-trace-steps">
        {visibleProgress.map((step) => {
          const index = progress.findIndex((item) => item.stage === step.stage);
          return (
            <li className={step.status} key={step.stage}>
              <i aria-hidden="true">
                {step.status === 'complete'
                  ? '✓'
                  : step.status === 'error'
                    ? '!'
                    : String(index + 1).padStart(2, '0')}
              </i>
              <BrandLogo brand={EXECUTION_SERVICES[step.stage].brand} />
              <div>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
                <em>{EXECUTION_SERVICES[step.stage].label}</em>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function TradingTerminal({
  state,
  quotes,
  onReplay,
  onTrade,
  walletInstalled,
  walletConnecting,
  connectedAccount,
  connectedAccounts,
  connectedChainId,
  walletQuote,
  walletQuoteLoading,
  walletQuoteError,
  onConnectWallet,
  onSelectWalletAccount,
  onIdentityReady,
  tradeLane,
  tradeError,
  tradeProgress,
  lastTrade,
  amountIn,
  onAmountChange,
  direction,
  onDirectionChange,
  children,
}: TradingTerminalProps) {
  const [slippageBps, setSlippageBps] = useState(50);
  const lane: Lane = walletQuote ? (walletQuote.tight ? 'human' : 'bot') : 'human';
  const selected = walletQuote ?? quotes[lane];
  const outputDelta = BigInt(quotes.human.amountOut) - BigInt(quotes.bot.amountOut);
  const tokenInSymbol = quotes.tokenInSymbol ?? (direction === 'tETH-to-tUSD' ? 'tETH' : 'tUSD');
  const tokenOutSymbol = quotes.tokenOutSymbol ?? (direction === 'tETH-to-tUSD' ? 'tUSD' : 'tETH');
  const deltaLabel = formatUnits(outputDelta, 18, tokenOutSymbol === 'tETH' ? 6 : 2);
  const sybilOverage = BigInt(quotes.sybil.amountIn) - BigInt(quotes.sybil.sharedQuotaRemaining);
  const executionEnabled = state.execution?.enabled === true;
  const submitting = tradeLane !== undefined;
  const selectedTradePending = tradeLane === lane;
  const quoteReady =
    walletQuote?.amountIn === amountIn &&
    walletQuote.chainId === state.runtime.chainId &&
    connectedChainId === state.runtime.chainId;
  const companionUrl = new URL(window.location.href);
  companionUrl.searchParams.delete('account');
  const minimumReceived =
    (BigInt(selected.amountOut) * BigInt(10_000 - slippageBps)) / 10_000n;
  const displayAmount = formatUnits(selected.amountIn, 18, 6);

  function updateDisplayAmount(value: string) {
    if (!/^\d*(?:\.\d{0,18})?$/.test(value) || value === '') return;
    const [whole = '0', fraction = ''] = value.split('.');
    const units = BigInt(whole || '0') * 10n ** 18n +
      BigInt((fraction + '0'.repeat(18)).slice(0, 18));
    if (units > 0n) onAmountChange(units.toString());
  }

  useEffect(() => {
    const accountLabel = connectedAccount
      ? walletQuote?.humanBacked
        ? 'HUMAN'
        : 'BOT'
      : 'MARKET';
    document.title = `${accountLabel} · Turing Pool`;
  }, [connectedAccount, walletQuote?.humanBacked]);

  return (
    <section className="trading-workspace" id="activity">
      <div className="demo-guide" aria-label="Interactive demo flow">
        <div>
          <span>01</span>
          <strong>Connect MetaMask</strong>
          <small>The World AgentBook mirror assigns the lane automatically</small>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <span>02</span>
          <strong>Execute a real fill</strong>
          <small>SwapVM opcode 34 settles through Aqua</small>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <span>03</span>
          <strong>Watch the market reprice</strong>
          <small>Volume moves both rates around the LP target</small>
        </div>
      </div>

      <div className="trading-grid">
        <div className="trading-main">
          <div className="terminal-panel execution-panel">
            <div className="panel-head">
              <div>
                <strong>Live fee market</strong>
                <span>Every dot is a mined fill · dashed lines are the next executable rates</span>
              </div>
              <div className="chart-controls" aria-label="Chart interval">
                <span>1H</span>
                <span className="active">ALL</span>
              </div>
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
          {children}
        </div>

        <aside className="terminal-panel quote-ticket" aria-label="Quote ticket">
        <div className="panel-head">
          <div><strong>Trade</strong><span>Exact input · live Base Sepolia execution</span></div>
          <span className="live-tag">LIVE</span>
        </div>
        <div className="ticket-body">
          <div className={`wallet-panel ${connectedAccount ? lane : 'disconnected'}`}>
            <div className="wallet-panel-head">
              <div>
                <span>MetaMask execution account</span>
                <strong>
                  {!connectedAccount
                    ? 'Connect a wallet to trade'
                    : walletQuoteLoading
                      ? 'Resolving World identity…'
                      : walletQuote?.humanBacked
                        ? walletQuote.tight
                          ? 'World-verified human · tight lane'
                          : 'World-verified human · quota-wide lane'
                        : 'Anonymous wallet · bot lane'}
                </strong>
              </div>
              {connectedAccount && (
                <b className={`wallet-tier ${lane}`}>
                  {walletQuote?.tier.toUpperCase() ?? 'CHECKING'}
                </b>
              )}
            </div>

            {!connectedAccount ? (
              <button
                className="wallet-connect-button"
                disabled={!walletInstalled || walletConnecting}
                onClick={() => void onConnectWallet(false)}
                type="button"
              >
                {walletConnecting
                  ? 'Opening MetaMask…'
                  : walletInstalled
                    ? 'Connect MetaMask'
                    : 'Install MetaMask to continue'}
              </button>
            ) : (
              <>
                <div className="wallet-account-row">
                  <code>{shortAddress(connectedAccount)}</code>
                  {connectedAccounts.length > 1 && (
                    <select
                      aria-label="Connected MetaMask account"
                      onChange={(event) => onSelectWalletAccount(event.target.value)}
                      value={connectedAccount}
                    >
                      {connectedAccounts.map((account) => (
                        <option key={account} value={account}>
                          {shortAddress(account)}
                        </option>
                      ))}
                    </select>
                  )}
                  <button onClick={() => void onConnectWallet(true)} type="button">
                    Change accounts
                  </button>
                </div>
                <small>
                  {walletQuote
                    ? walletQuote.humanBacked
                      ? `Mirrored humanId ${walletQuote.humanId.slice(0, 10)}… · ${formatUnits(walletQuote.balance)} ${walletQuote.tokenInSymbol} available`
                      : `World mirror returned humanId 0 · ${formatUnits(walletQuote.balance)} ${walletQuote.tokenInSymbol} available`
                    : walletQuoteError ?? 'Reading wallet balance, allowance, and identity…'}
                </small>
                <WorldIdentityControl
                  account={connectedAccount}
                  quotedAsHuman={walletQuote?.humanBacked === true}
                  onIdentityReady={onIdentityReady}
                />
                <a href={companionUrl.toString()} rel="noreferrer" target="_blank">
                  Open second wallet tab ↗
                </a>
              </>
            )}
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
          <div className="order-controls">
            <label>
              Order type
              <strong>Market</strong>
            </label>
            <label>
              Slippage
              <select
                aria-label="Maximum slippage"
                onChange={(event) => setSlippageBps(Number(event.target.value))}
                value={slippageBps}
              >
                <option value={10}>0.10%</option>
                <option value={50}>0.50%</option>
                <option value={100}>1.00%</option>
              </select>
            </label>
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
            <label>
              Pay
              <span>
                Balance{' '}
                {walletQuote ? formatUnits(walletQuote.balance, 18, 4) : '—'}
              </span>
            </label>
            <div>
              <input
                aria-label={`Amount of ${tokenInSymbol} to pay`}
                inputMode="decimal"
                onChange={(event) => updateDisplayAmount(event.target.value)}
                value={displayAmount}
              />
              <b>{tokenInSymbol}</b>
            </div>
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
            <div>
              <dt>Risk lane</dt>
              <dd>
                {selected.tier.toUpperCase()} ·{' '}
                {walletQuote?.humanBacked
                  ? walletQuote.tight
                    ? 'human bounded'
                    : 'human quota exceeded'
                  : 'anonymous'}
              </dd>
            </div>
            <div><dt>Live LP rate</dt><dd>{selected.feeBps} bps</dd></div>
            <div><dt>Price impact</dt><dd>{(selected.feeBps / 100).toFixed(2)}%</dd></div>
            <div>
              <dt>Minimum received</dt>
              <dd>
                {formatUnits(minimumReceived, 18, tokenOutSymbol === 'tETH' ? 6 : 2)}{' '}
                {tokenOutSymbol}
              </dd>
            </div>
            <div><dt>Route</dt><dd>{tokenInSymbol} → SwapVM #34 → Aqua → {tokenOutSymbol}</dd></div>
            <div><dt>Network</dt><dd>Base Sepolia · gas shown in MetaMask</dd></div>
            <div>
              <dt>Verified price edge</dt>
              <dd className={lane === 'human' ? 'positive' : 'negative'}>
                {lane === 'human' ? `+${deltaLabel}` : `−${deltaLabel}`} {tokenOutSymbol}
              </dd>
            </div>
          </dl>
          <button
            className={`trade-action ${lane}`}
            disabled={
              submitting ||
              walletConnecting ||
              (connectedAccount !== undefined &&
                (walletQuoteLoading || !quoteReady || walletQuote?.sufficientBalance === false))
            }
            onClick={() => {
              if (!connectedAccount) void onConnectWallet(false);
              else if (executionEnabled) void onTrade(selected.amountIn, direction);
              else onReplay();
            }}
            type="button"
          >
            {!connectedAccount
              ? walletInstalled
                ? 'Connect MetaMask to trade'
                : 'MetaMask required'
              : walletQuote?.sufficientBalance === false
                ? `Insufficient ${walletQuote.tokenInSymbol} balance`
              : walletQuoteLoading || !quoteReady
              ? 'Refreshing on-chain quote…'
              : selectedTradePending
              ? 'Confirming wallet trade…'
              : executionEnabled
                ? `${walletQuote?.requiresApproval ? 'Approve & ' : ''}${direction === 'tUSD-to-tETH' ? 'buy' : 'sell'} with MetaMask`
                : 'Interactive execution unavailable'}
          </button>
          <p className="ticket-note">
            {!connectedAccount
              ? 'Connect both MetaMask accounts, then select a different account in each browser tab.'
              : executionEnabled
                ? `MetaMask signs the Base SwapVM transaction. The World mirror selects the lane; mined volume reprices opcode ${state.execution?.opcode}.`
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
          <details className="sybil-alert">
            <summary>
              <span>Linked-wallet bypass test</span>
              <strong>{quotes.sybil.tier.toUpperCase()} ↗</strong>
            </summary>
            <p>{formatUnits(quotes.sybil.sharedQuotaRemaining)} {tokenInSymbol} shared remaining</p>
            <small>Wallet #2 asks for remaining + {sybilOverage.toString()} wei. A new wallet cannot reset the human risk budget.</small>
          </details>
        </aside>
      </div>
    </section>
  );
}
