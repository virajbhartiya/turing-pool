import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { apiBase } from '../hooks/useProtocol';
import { formatUnits, shortAddress, transactionExplorer } from '../lib/format';
import type {
  AutopilotPlan,
  DemoTradeError,
  DemoTradeProgress,
  DemoTradeResult,
  ProtocolState,
} from '../types';
import { BrandLogo } from './BrandLogo';
import { FeeChart } from './FeeChart';
import { StrategyOrderForm } from './StrategyOrderForm';
import type { StrategyDraftIntent } from '../lib/strategy-draft';
import type { DexView } from './DexHeader';

interface AutopilotWorkspaceProps {
  state: ProtocolState;
  account?: string;
  walletConnecting: boolean;
  onConnectWallet: (requestAccountSelection?: boolean) => Promise<void>;
  onOpenVerify: () => void;
  onExecute: (amountIn: string, direction: AutopilotPlan['direction'], strategyId?: string) => Promise<void>;
  onNavigate: (view: DexView) => void;
  lastTrade?: DemoTradeResult;
  tradeProgress: DemoTradeProgress[];
  tradeError?: DemoTradeError;
}

const PRESETS = [
  {
    id: 'dca',
    label: 'Verified DCA',
    prompt: 'Convert 500 tUSD to tETH in 5 slices when bot activity is below 65%, fee is under 35 bps, and execution dispersion is below 150 bps.',
  },
  {
    id: 'dip',
    label: 'Price discipline',
    prompt: 'Convert 750 tUSD to tETH in 5 slices when execution dispersion is below 150 bps, fee is under 35 bps, and bot activity is below 50%.',
  },
  {
    id: 'shield',
    label: 'Liquidity shield',
    prompt: 'Convert 1 tETH to tUSD in 4 slices only when bot activity is below 45%, execution dispersion is below 100 bps, and fee is under 35 bps.',
  },
];

class AutopilotRequestError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

async function autopilotRequest<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      signal: controller.signal,
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => undefined) as T | { error?: string } | undefined;
    if (!response.ok) {
      throw new AutopilotRequestError(typeof result === 'object' && result !== null && 'error' in result && result.error
        ? result.error
        : `Autopilot request failed with HTTP ${response.status}`, response.status);
    }
    if (!result) throw new AutopilotRequestError('The strategy service returned an empty response. Please retry.');
    return result as T;
  } catch (error) {
    if (controller.signal.aborted) throw new AutopilotRequestError('The strategy request timed out after 15 seconds. Please retry; check any pending receipt before executing.');
    throw error;
  } finally { clearTimeout(timeout); }
}

function decisionLabel(plan: AutopilotPlan): string {
  if (plan.decision === 'execute') return 'Conditions clear';
  if (plan.decision === 'paused') return 'Human paused';
  if (plan.decision === 'complete') return 'Plan complete';
  return 'Waiting safely';
}

function ProgressRing({ complete, total }: { complete: number; total: number }) {
  const progress = total > 0 ? Math.min(1, complete / total) : 0;
  const degrees = Math.round(progress * 360);
  return (
    <div
      aria-label={`${complete} of ${total} slices complete`}
      className="autopilot-ring"
      style={{ '--progress': `${degrees}deg` } as CSSProperties}
    >
      <div><strong>{complete}</strong><span>of {total}</span></div>
    </div>
  );
}

export function AutopilotWorkspace({
  state,
  account,
  walletConnecting,
  onConnectWallet,
  onOpenVerify,
  onExecute,
  onNavigate,
  lastTrade,
  tradeProgress,
  tradeError,
}: AutopilotWorkspaceProps) {
  const [composerMode, setComposerMode] = useState<'form' | 'instruction'>('form');
  const [prompt, setPrompt] = useState(PRESETS[0].prompt);
  const [plan, setPlan] = useState<AutopilotPlan>();
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'plan' | 'activate' | 'evaluate' | 'pause' | 'execute'>();
  const [error, setError] = useState<string>();
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [feedback, setFeedback] = useState<{ message: string; checkedAt?: string; checkNumber?: number }>();
  const evaluationCount = useRef(0);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const orderProgress = useRef<HTMLElement>(null);
  const orderBuilder = useRef<HTMLElement>(null);
  const marketDetails = useRef<HTMLDetailsElement>(null);
  const moveTo = (element: HTMLElement | null) => {
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  };
  const [unreconciledHash, setUnreconciledHash] = useState<string>();
  const storageKey = `turing:v1:strategy:${state.runtime.chainId}:${account?.toLowerCase() ?? 'disconnected'}`;
  const activeStorageKey = useRef(storageKey);
  activeStorageKey.current = storageKey;
  const pendingTrade = useRef<
    | {
        planId: string;
        previousTransactionHash?: string;
      }
    | undefined
  >(undefined);
  const confirmedTrade = useRef<string | undefined>(undefined);

  const generatePlan = useCallback(async (nextPrompt = prompt, intent?: StrategyDraftIntent) => {
    setAction('plan');
    setError(undefined);
    try {
      const created = await autopilotRequest<AutopilotPlan>('/autopilot/plan', {
        ...intent,
        prompt: nextPrompt,
        owner: account,
      });
      localStorage.setItem(storageKey, created.id);
      if (activeStorageKey.current !== storageKey) return;
      setPlan(created);
      evaluationCount.current = 0;
      setFeedback({ message: 'Strategy generated. Review the limits, then activate. No transaction submitted.' });
    } catch (caught) {
      if (activeStorageKey.current !== storageKey) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (activeStorageKey.current === storageKey) { setLoading(false); setAction(undefined); }
    }
  }, [account, prompt, storageKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPlan(undefined);
    setError(undefined);
    setFeedback(undefined);
    setAction(undefined);
    evaluationCount.current = 0;
    pendingTrade.current = undefined;
    confirmedTrade.current = undefined;
    setUnreconciledHash(undefined);
    const saved = localStorage.getItem(storageKey);
    const recover = async () => {
      if (saved) {
        try {
          const restored = await autopilotRequest<AutopilotPlan>(`/autopilot/${encodeURIComponent(saved)}`);
          if (cancelled) return;
          if (account && !restored.owner) {
            await generatePlan(restored.prompt);
            return;
          }
          setPlan(restored);
          setFeedback({ message: 'Saved strategy loaded. Conditions are checked again before wallet preparation.' });
          setPrompt(restored.prompt);
          setUnreconciledHash(localStorage.getItem(`${storageKey}:pending`) ?? undefined);
          setLoading(false);
          return;
        } catch (caught) {
          if (cancelled) return;
          // An outage is not evidence that the saved plan is gone. Keep its ID
          // and pending receipt so Retry can recover the original position.
          if (!(caught instanceof AutopilotRequestError) || caught.status !== 404) {
            setError(caught instanceof Error ? caught.message : String(caught));
            setLoading(false);
            return;
          }
        }
      }
      if (!cancelled) await generatePlan(prompt);
    };
    void recover();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, recoveryAttempt]);

  const reconcile = useCallback(async (planId: string, transactionHash: string) => {
    setUnreconciledHash(transactionHash);
    localStorage.setItem(`${storageKey}:pending`, transactionHash);
    try {
      const updated = await autopilotRequest<AutopilotPlan>(`/autopilot/${planId}/confirm`, { transactionHash });
      localStorage.removeItem(`${storageKey}:pending`);
      if (activeStorageKey.current !== storageKey) return;
      setPlan(updated);
      pendingTrade.current = undefined;
      setUnreconciledHash(undefined);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAction(undefined);
    }
  }, [storageKey]);

  const updatePlan = useCallback(async (verb: 'activate' | 'evaluate' | 'pause') => {
    if (!plan) return;
    setAction(verb);
    setError(undefined);
    try {
      const updated = await autopilotRequest<AutopilotPlan>(`/autopilot/${plan.id}/${verb}`, {});
      if (activeStorageKey.current !== storageKey) return;
      setPlan(updated);
      if (verb === 'evaluate') evaluationCount.current += 1;
      setFeedback({
        message: verb === 'activate' ? 'Strategy activated. Activation does not submit a transaction.'
          : verb === 'pause' ? 'Strategy paused. No new slice will be submitted.'
            : 'Live conditions checked. No transaction submitted by this check.',
        checkedAt: new Date().toLocaleTimeString(),
        checkNumber: verb === 'evaluate' ? evaluationCount.current : undefined,
      });
    } catch (caught) {
      if (activeStorageKey.current !== storageKey) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (activeStorageKey.current === storageKey) setAction(undefined);
    }
  }, [plan, storageKey]);

  useEffect(() => {
    const transactionHash = lastTrade?.transactionHash;
    const pending = pendingTrade.current;
    if (!plan || !transactionHash || pending?.planId !== plan.id) return;
    if (transactionHash === pending.previousTransactionHash) return;
    if (confirmedTrade.current === transactionHash) return;
    confirmedTrade.current = transactionHash;
    void reconcile(plan.id, transactionHash);
  }, [lastTrade, plan, reconcile]);

  useEffect(() => {
    if (!tradeError || !pendingTrade.current) return;
    setUnreconciledHash(localStorage.getItem(`${storageKey}:pending`) ?? undefined);
    pendingTrade.current = undefined;
    setAction(undefined);
  }, [storageKey, tradeError]);

  const executeNext = async () => {
    if (!plan) return;
    if (!account) {
      await onConnectWallet(false);
      return;
    }
    if (!plan.owner) {
      onOpenVerify();
      return;
    }
    if (plan.status !== 'active') {
      await updatePlan('activate');
      return;
    }
    if (plan.decision !== 'execute') {
      await updatePlan('evaluate');
      return;
    }
    setAction('execute');
    setError(undefined);
    pendingTrade.current = {
      planId: plan.id,
      previousTransactionHash: lastTrade?.transactionHash,
    };
    await onExecute(plan.sliceAmount, plan.direction, plan.id);
    // A successful receipt is reconciled by the lastTrade effect. App-level
    // transaction failures are handled by the tradeError effect.
  };

  const timeline = useMemo(() => {
    if (!plan) return [];
    const events = [
      {
        label: 'Observe',
        title: 'Live market window loaded',
        detail: `${plan.evidence.fills} fills · ${plan.evidence.source === 'nuthatch' ? 'Nuthatch SQL + MCP' : plan.evidence.source === 'snapshot' ? 'preview evidence' : 'local event evidence'}`,
        state: plan.evidence.available ? 'complete' : 'waiting',
      },
      {
        label: 'Reason',
        title: decisionLabel(plan),
        detail: plan.decisionSummary,
        state: plan.decision === 'execute' ? 'complete' : plan.decision,
      },
      {
        label: 'Execute',
        title: plan.executions.length ? `Aqua slice ${plan.executedSlices} settled` : 'Aqua execution ready',
        detail: plan.executions.length
          ? `${shortAddress(plan.executions.at(-1)?.transactionHash)} confirmed on World Chain`
          : `${formatUnits(plan.sliceAmount)} ${plan.inputToken} in the next wallet-approved slice`,
        state: action === 'execute' ? 'active' : plan.executions.length ? 'complete' : 'queued',
      },
      {
        label: 'Prove',
        title: plan.executions.length ? 'On-chain receipt validated' : 'Awaiting execution receipt',
        detail: plan.executions.length
          ? `Decision ${plan.decisionHash.slice(0, 12)}… bound to live evidence`
          : 'Every action will remain independently inspectable',
        state: plan.executions.length ? 'complete' : 'queued',
      },
    ];
    return events;
  }, [action, plan]);

  return (
    <section className="autopilot-page">
      <header className="studio-hero">
        <div className="studio-hero-copy">
          <span className="studio-eyebrow"><i />THE STRATEGY STUDIO</span>
          <h1>A little intention.<br /><em>A better way to trade.</em></h1>
          <p>You set the budget and the boundaries. Your agent checks the market. Every trade stays your decision.</p>
          <div className="hero-actions"><button className="hero-primary" type="button" onClick={() => { moveTo(orderBuilder.current); orderBuilder.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }); }}>Build a strategy <span aria-hidden="true">↗</span></button><button className="hero-secondary" type="button" onClick={() => onNavigate('trade')}>Just want to swap? <span aria-hidden="true">→</span></button></div>
          <span className="hero-assurance"><svg width="13" height="14" viewBox="0 0 16 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M8 1l6 3v5c0 4-6 7-6 7S2 13 2 9V4z M5 8l2 2 4-4" /></svg>Your wallet. Your approval. Always.</span>
        </div>
        <aside className="hero-companion" aria-label="Getting started">
          <div className="companion-topline"><span>BUILT AROUND YOU</span><span aria-hidden="true">↗</span></div>
          <h2>From an idea<br />to a considered trade.</h2>
          <ol className="companion-checklist">
            <li><span>01</span><div><strong>Make a plan</strong><small>Start with an amount. No wallet needed.</small></div></li>
            <li><span>02</span><div><strong>Make it yours</strong><small>Connect your wallet. World ID can unlock tighter pricing.</small></div></li>
            <li><span>03</span><div><strong>Give the go-ahead</strong><small>Review conditions. Approve each trade.</small></div></li>
          </ol>
          <button className="companion-link" type="button" onClick={onOpenVerify}>{account ? 'Manage your trading identity' : 'First time? Set up your wallet'} <span aria-hidden="true">→</span></button>
        </aside>
      </header>

      <nav className="studio-workflow" aria-label="Strategy workspace shortcuts">
        <div><span className="eyebrow">YOUR WORKSPACE</span><h2>Let’s put your plan together.</h2></div>
        <div className="workflow-shortcuts"><button type="button" onClick={() => moveTo(orderBuilder.current)}><span>01</span>Build order</button><i aria-hidden="true">/</i><button type="button" onClick={() => moveTo(orderProgress.current)}><span>02</span>Review & track</button><i aria-hidden="true">/</i><button type="button" onClick={() => { if (marketDetails.current) { marketDetails.current.open = true; moveTo(marketDetails.current); } }}><span>03</span>Market checks</button></div>
      </nav>

      <div className="autopilot-grid">
        <article className="strategy-market surface">
          <header className="card-heading"><div><span className="eyebrow">THE MARKET</span><h2><span className="market-token" aria-hidden="true">Ξ</span>tETH <span className="muted">/ tUSD</span></h2></div><span className="quiet-badge"><i className="status-dot" />Confirmed trades</span></header>
          <div className="market-strip"><div><span>Verified fee</span><strong>{(state.feeController.tightFeeBps / 100).toFixed(2)}%</strong></div><div><span>Standard fee</span><strong>{(state.feeController.wideFeeBps / 100).toFixed(2)}%</strong></div><div><span>Pool liquidity</span><strong>{formatUnits(state.pool.balance0, 18, 3)} tETH</strong></div></div>
          <FeeChart controller={state.feeController} feeHistory={state.feeHistory ?? []} pool={state.pool} swaps={state.swaps} mode="price" tokenIn={state.pool.token0} />
        </article>
        <section className="strategy-ticket panel-frame" ref={orderBuilder} tabIndex={-1} aria-label="Build your strategy">
          <StrategyOrderForm mode={composerMode} onModeChange={setComposerMode} prompt={prompt} onPromptChange={setPrompt} promptRef={promptInput} onGenerate={(nextPrompt, intent) => {
            setPrompt(nextPrompt);
            void generatePlan(nextPrompt, intent).then(() => {
              moveTo(orderProgress.current);
            });
          }} disabled={Boolean(action) || Boolean(unreconciledHash)} building={action === 'plan'} />
          <div className="order-identity"><BrandLogo brand="world" /><span>{plan?.owner ? 'Wallet connected' : 'Connect a wallet to activate'}<small>{account ? shortAddress(account) : 'World ID can unlock tighter pricing'}</small></span><button className="text-button" type="button" onClick={onOpenVerify}>Account ↗</button></div>
        </section>

        <section className="autopilot-position panel-frame" ref={orderProgress} tabIndex={-1} aria-label="Your strategy review">
          <div className="autopilot-section-head">
            <div><span>Execution desk</span><h2>Order progress</h2></div>
            <b className={`autopilot-status ${plan?.status ?? 'draft'}`}>{plan?.status ?? 'draft'}</b>
          </div>
          {loading ? (
            <div className="autopilot-loading"><i /><span>Compiling a safe execution plan…</span></div>
          ) : !plan ? (
            <div className="position-empty">
              <p>A strategy could not be loaded. No new transaction was submitted.</p>
              <button className="autopilot-secondary" disabled={Boolean(action)} onClick={() => setRecoveryAttempt((attempt) => attempt + 1)} type="button">Retry loading strategy</button>
            </div>
          ) : (
            <>
              <div className="position-route">
                <div><span>From</span><strong>{formatUnits(plan.totalAmount)} {plan.inputToken}</strong></div>
                <i>→</i>
                <div><span>Into</span><strong>{plan.outputToken}</strong></div>
              </div>
              <div className={`position-feedback ${plan.decision}`} role="status" aria-live="polite" aria-atomic="true">
                <strong>{action === 'evaluate' ? 'Checking the latest market evidence…' : decisionLabel(plan)}</strong>
                <p>{feedback?.message ?? plan.decisionSummary}</p>
                {plan.checks.some((check) => !check.passed) ? (
                  <ul>{plan.checks.filter((check) => !check.passed).map((check) => (
                    <li key={check.key}><b>{check.label}:</b> {check.value} · limit {check.limit}</li>
                  ))}</ul>
                ) : plan.status === 'active' && plan.decision === 'execute' ? (
                  <p>Checks pass. Click Execute slice {plan.executedSlices + 1} to review and approve the transaction in your wallet.</p>
                ) : null}
                
                {feedback?.checkedAt ? <small>{feedback.checkNumber ? `Check #${feedback.checkNumber} · ` : ''}Checked at {feedback.checkedAt}</small> : null}
              </div>
              <div className="position-actions">
                <button
                  className="autopilot-primary"
                  disabled={Boolean(action) || Boolean(unreconciledHash) || plan.status === 'completed'}
                  onClick={() => void executeNext()}
                  type="button"
                >
                  {action === 'evaluate' ? 'Checking live conditions…' : action === 'activate' ? 'Activating strategy…' : action === 'plan' ? 'Building strategy…' : plan.status === 'completed' ? 'Strategy complete' : !account
                    ? walletConnecting ? 'Opening wallet…' : 'Connect wallet to activate'
                    : !plan.owner
                      ? 'Connect wallet to activate'
                    : plan.status !== 'active'
                      ? 'Activate autopilot'
                      : plan.decision === 'execute'
                        ? action === 'execute' ? 'Executing Aqua slice…' : `Execute slice ${plan.executedSlices + 1}`
                        : 'Re-evaluate live conditions'}
                </button>
                <button
                  className="autopilot-secondary"
                  disabled={!plan || plan.status === 'paused' || plan.status === 'completed' || Boolean(action)}
                  onClick={() => void updatePlan('pause')}
                  type="button"
                >
                  Pause agent
                </button>
              </div>
              <div className="position-progress">
                <ProgressRing complete={plan.executedSlices} total={plan.slices} />
                <div>
                  <span>Strategy progress</span>
                  <strong>{formatUnits(plan.remainingAmount)} {plan.inputToken} remaining</strong>
                  <small>{formatUnits(plan.sliceAmount)} {plan.inputToken} next slice · expires {new Date(plan.expiresAt).toLocaleString()}</small>
                </div>
              </div>
              <div className="slice-track" aria-label="DCA slice progress">
                {Array.from({ length: plan.slices }, (_, index) => (
                  <i className={index < plan.executedSlices ? 'complete' : index === plan.executedSlices ? 'next' : ''} key={index}>
                    <span>{index + 1}</span>
                  </i>
                ))}
              </div>
              <dl className="position-guards">
                <div><dt>Max unverified flow</dt><dd>{(plan.conditions.maxBotShareBps / 100).toFixed(0)}%</dd></div>
                <div><dt>Max verified fee</dt><dd>{plan.conditions.maxFeeBps} bps</dd></div>
                <div><dt>Max dispersion</dt><dd>{plan.conditions.maxPriceGapBps} bps</dd></div>
                <div><dt>Custody</dt><dd>Your wallet</dd></div>
              </dl>


              {plan.decision === 'wait' ? <button className="position-edit" disabled={Boolean(action) || Boolean(unreconciledHash)} onClick={() => { setComposerMode('instruction'); requestAnimationFrame(() => { promptInput.current?.focus(); promptInput.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }); }} type="button">Edit strategy instruction</button> : null}
            </>
          )}
          {(error || tradeError) ? (
            <div className="autopilot-error position-error" role="alert">
              <strong>Action not completed</strong>
              <span>{error ?? tradeError?.error}</span>
              {plan ? <span>Check any pending receipt before retrying. Your strategy limits have not changed.</span> : null}
            </div>
          ) : null}
        </section>

        <details className="autopilot-brain panel-frame" ref={marketDetails} tabIndex={-1}>
          <summary><div><strong>Market conditions & decision details</strong><small>Understand the checks behind your strategy</small></div><span>{plan ? `${plan.checks.filter((check) => check.passed).length}/${plan.checks.length} checks passed` : 'Loading'}</span></summary>
          {plan && (
            <>
              <div className="evidence-tape">
                <article><span>Searcher flow</span><strong>{(plan.evidence.botShareBps / 100).toFixed(1)}%</strong><small>last {plan.evidence.fills} fills</small></article>
                <article><span>Verified fee</span><strong>{plan.evidence.currentTightFeeBps}<em> bps</em></strong><small>wide {plan.evidence.currentWideFeeBps} bps</small></article>
                <article><span>Price dispersion</span><strong>{plan.evidence.priceGapBps.toFixed(1)}<em> bps</em></strong><small>execution quality</small></article>
              </div>
              <ol className="reasoning-timeline">
                {timeline.map((event) => (
                  <li className={event.state} key={event.label}>
                    <i />
                    <div><span>{event.label}</span><strong>{event.title}</strong><small>{event.detail}</small></div>
                  </li>
                ))}
              </ol>
              <div className="risk-checks">
                {plan.checks.map((check) => (
                  <div className={check.passed ? 'passed' : 'failed'} key={check.key}>
                    <i>{check.passed ? '✓' : '!'}</i>
                    <span><strong>{check.label}</strong><small>{check.value} · policy {check.limit}</small></span>
                  </div>
                ))}
              </div>
              <footer className="evidence-footer">
                <BrandLogo brand="nuthatch" />
                <span><strong>Evidence provenance</strong><small>{plan.evidence.provenance}</small></span>
                <code>{plan.evidence.indexedBlock ? `#${plan.evidence.indexedBlock}` : 'PREVIEW'}</code>
              </footer>
            </>
          )}
        </details>
      </div>

      {unreconciledHash && plan && (
        <div className="autopilot-error" role="status">
          <span>A transaction was submitted. Validate its receipt before executing another slice.</span>
          <a href={transactionExplorer(state.runtime.chainId, unreconciledHash)} target="_blank" rel="noreferrer">View transaction ↗</a>
          <button className="autopilot-secondary" disabled={Boolean(action)} onClick={() => { setAction('execute'); void reconcile(plan.id, unreconciledHash); }} type="button">Retry receipt verification</button>
        </div>
      )}

      {Boolean(plan?.executions.length) && (
        <nav className="autopilot-next-actions" aria-label="Strategy transaction receipts">
          <span>On-chain receipts</span>
          {plan?.executions.map((execution) => (
            <a key={execution.transactionHash} href={transactionExplorer(state.runtime.chainId, execution.transactionHash)} target="_blank" rel="noreferrer">Slice {execution.slice} · {shortAddress(execution.transactionHash)} ↗</a>
          ))}
        </nav>
      )}

      <p className="workspace-help">Prefer a single trade? <button className="text-button" onClick={() => onNavigate('trade')} type="button">Open Swap →</button></p>

      {lastTrade && plan?.executions.some((execution) => execution.transactionHash === lastTrade.transactionHash) && (
        <a
          className="autopilot-receipt"
          href={transactionExplorer(state.runtime.chainId, lastTrade.transactionHash)}
          rel="noreferrer"
          target="_blank"
        >
          <span>Latest verified execution</span>
          <strong>{formatUnits(lastTrade.amountIn)} {lastTrade.tokenInSymbol} → {formatUnits(lastTrade.amountOut)} {lastTrade.tokenOutSymbol}</strong>
          <code>{shortAddress(lastTrade.transactionHash)} ↗</code>
        </a>
      )}

      {action === 'execute' && tradeProgress.length > 0 && (
        <div className="autopilot-live-strip" aria-live="polite">
          <i />
          <span>{tradeProgress.findLast((step) => step.status === 'active')?.title ?? 'Reconciling execution receipt'}</span>
          <strong>LIVE</strong>
        </div>
      )}
    </section>
  );
}
