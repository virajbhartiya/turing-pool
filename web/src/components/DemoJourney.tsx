import type { DexView } from './DexHeader';

interface DemoJourneyProps {
  activeView: DexView;
  live: boolean;
  onNavigate: (view: DexView) => void;
}

const JOURNEY: Array<{
  view: DexView;
  eyebrow: string;
  label: string;
  detail: string;
}> = [
  { view: 'verify', eyebrow: '01', label: 'Fund + verify', detail: 'Wallet · World' },
  { view: 'autopilot', eyebrow: '02', label: 'Define intent', detail: 'Bounded strategy' },
  { view: 'trade', eyebrow: '03', label: 'Execute', detail: 'SwapVM · Aqua' },
  { view: 'pool', eyebrow: '04', label: 'Provide liquidity', detail: 'Self-custodial LP' },
  { view: 'protocol', eyebrow: '05', label: 'Inspect proof', detail: 'Receipt · evidence' },
];

export function DemoJourney({ activeView, live, onNavigate }: DemoJourneyProps) {
  return (
    <section className="demo-journey" aria-label="Trading workflow">
      <header>
        <span><i /> Your workflow</span>
        <strong>One market. One human-backed agent. Every step verifiable.</strong>
        <b className={live ? 'live' : undefined}>{live ? 'LIVE TEST ASSETS' : 'PREVIEW'}</b>
      </header>
      <ol>
        {JOURNEY.map((step) => (
          <li className={activeView === step.view ? 'active' : undefined} key={step.view}>
            <button onClick={() => onNavigate(step.view)} type="button">
              <span>{step.eyebrow}</span>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
