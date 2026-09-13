import { useState, type RefObject } from 'react';
import { buildStrategyDraft, DEFAULT_STRATEGY_DRAFT, type StrategyDraft, type StrategyDraftIntent } from '../lib/strategy-draft';
import { formatUnits } from '../lib/format';

interface Props {
  mode: 'form' | 'instruction';
  onModeChange: (mode: 'form' | 'instruction') => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  onGenerate: (prompt: string, intent?: StrategyDraftIntent) => void;
  disabled: boolean;
  building: boolean;
}

export function StrategyOrderForm({ mode, onModeChange, prompt, onPromptChange, promptRef, onGenerate, disabled, building }: Props) {
  const [draft, setDraft] = useState<StrategyDraft>(DEFAULT_STRATEGY_DRAFT);
  const [attempted, setAttempted] = useState(false);
  const change = (key: keyof StrategyDraft, value: string) => setDraft((previous) => ({ ...previous, [key]: value }));
  let intent: StrategyDraftIntent | undefined;
  let error: string | undefined;
  try { intent = buildStrategyDraft(draft); } catch (caught) { error = (caught as Error).message; }
  const input = draft.direction === 'tUSD-to-tETH' ? 'tUSD' : 'tETH';
  const output = input === 'tUSD' ? 'tETH' : 'tUSD';
  return (
    <form className="strategy-order-form" onSubmit={(event) => {
      event.preventDefault();
      setAttempted(true);
      if (disabled) return;
      if (mode === 'instruction') { if (prompt.trim().length >= 8) onGenerate(prompt); }
      else if (intent) onGenerate(intent.prompt, intent);
    }}>
      <div className="order-form-title"><div><span className="eyebrow">MAKE IT YOURS</span><h2>Build your order</h2></div><span className="order-kind">01 / Plan</span></div>
      <div className="order-entry-mode" aria-label="Strategy entry method">
        <button type="button" aria-pressed={mode === 'form'} onClick={() => onModeChange('form')}>Set parameters</button>
        <button type="button" aria-pressed={mode === 'instruction'} onClick={() => onModeChange('instruction')}>Write instruction</button>
      </div>
      <fieldset disabled={disabled}>
        {mode === 'form' ? <>
          <div className="order-asset-field"><label htmlFor="strategy-budget">Total budget</label><div><input id="strategy-budget" aria-label="Strategy budget" inputMode="decimal" value={draft.amount} onChange={(event) => change('amount', event.target.value)} /><span className="asset-badge"><i className={input === 'tUSD' ? 'usd' : 'eth'}>{input === 'tUSD' ? '$' : 'Ξ'}</i>{input}</span></div></div>
          <div className="order-direction"><span>Buy <strong>{output}</strong></span><button type="button" onClick={() => change('direction', draft.direction === 'tUSD-to-tETH' ? 'tETH-to-tUSD' : 'tUSD-to-tETH')} aria-label="Reverse strategy tokens">⇅</button></div>
          <div className="order-settings-row"><label>Split into<input aria-label="Number of trades" inputMode="numeric" value={draft.slices} onChange={(event) => change('slices', event.target.value)} /><small>trades</small></label><label>Valid for<select aria-label="Strategy expiry" value={draft.expiresInHours} onChange={(event) => change('expiresInHours', event.target.value)}><option value="1">1 hour</option><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select><small>not a trading schedule</small></label></div>
          <details className="order-limits"><summary>Execution limits<span>{draft.maxFee}% max fee</span></summary><div>
            <label>Maximum fee (%)<input aria-label="Maximum strategy fee percent" inputMode="decimal" value={draft.maxFee} onChange={(event) => change('maxFee', event.target.value)} /></label>
            <label>Maximum dispersion (%)<input aria-label="Maximum dispersion percent" inputMode="decimal" value={draft.maxDispersion} onChange={(event) => change('maxDispersion', event.target.value)} /></label>
            <label>Maximum unverified flow (%)<input aria-label="Maximum unverified flow percent" inputMode="decimal" value={draft.maxUnverifiedFlow} onChange={(event) => change('maxUnverifiedFlow', event.target.value)} /></label>
            <p>These limits can block a trade. They are never relaxed automatically.</p>
          </div></details>
          <div className="order-preview"><span>Per trade</span><strong>{intent ? formatUnits(BigInt(intent.totalAmount) / BigInt(intent.slices), 18, 6) : '—'} {input}</strong><small>Only when checks pass · wallet approval required</small></div>
        </> : <label className="instruction-entry">Describe your order<textarea ref={promptRef} aria-label="Strategy instruction" value={prompt} onChange={(event) => onPromptChange(event.target.value)} rows={6} maxLength={600} /><small>Include your amount, number of trades, and risk limits.</small></label>}
      </fieldset>
      {attempted && mode === 'form' && error ? <p className="order-validation" role="alert">{error}</p> : null}
      {attempted && mode === 'instruction' && prompt.trim().length < 8 ? <p className="order-validation" role="alert">Describe your strategy in at least eight characters.</p> : null}
      <button className="autopilot-generate" type="submit" disabled={disabled}>{building ? 'Building strategy…' : 'Generate strategy'}</button>
      <p className="order-disclaimer">Creates a draft for review. No tokens move.</p>
    </form>
  );
}
