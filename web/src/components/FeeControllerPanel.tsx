import type { CSSProperties } from 'react';

import type { FeeController } from '../types';

interface FeeControllerPanelProps {
  controller: FeeController;
  copied: boolean;
  onReplay: () => void;
}

export function FeeControllerPanel({ controller, copied, onReplay }: FeeControllerPanelProps) {
  const humanShare = controller.humanShareBps / 100;
  const botShare = 100 - humanShare;

  return (
    <section className="controller-section" id="risk">
      <div className="controller-panel">
        <div className="controller-copy">
          <span>Activity-priced fee controller</span>
          <h2>Retail discount funded by bot flow.</h2>
          <p>
            Every observed fill updates the mix. The controller lowers bounded human flow,
            raises unbounded bot flow, and holds the LP’s blended fee revenue at target.
          </p>
          <div className="controller-status"><i />{controller.status.replaceAll('-', ' ')}</div>
        </div>
        <div className="mix-visual">
          <div
            className="mix-ring"
            style={{ '--human-share': `${humanShare}%` } as CSSProperties}
            aria-label={`${humanShare.toFixed(1)} percent verified human flow`}
          >
            <strong>{humanShare.toFixed(0)}%</strong>
            <span>human flow</span>
          </div>
          <div className="mix-legend">
            <span><i className="human" />{humanShare.toFixed(1)}% verified</span>
            <span><i className="bot" />{botShare.toFixed(1)}% anonymous</span>
          </div>
        </div>
        <div className="fee-equation">
          <div className="fee-term human"><span>Retail</span><strong>{controller.tightFeeBps}</strong><small>bps</small></div>
          <b>× {humanShare.toFixed(0)}%</b>
          <i>+</i>
          <div className="fee-term bot"><span>Bot</span><strong>{controller.wideFeeBps}</strong><small>bps</small></div>
          <b>× {botShare.toFixed(0)}%</b>
          <i>=</i>
          <div className="fee-term target"><span>LP blended</span><strong>{controller.projectedWeightedFeeBps.toFixed(1)}</strong><small>bps</small></div>
        </div>
      </div>

      <div className="proof-rail" aria-label="Demo proof sequence">
        <div><span>01</span><strong>Compare</strong><small>One trade, two risk prices</small><b>✓</b></div>
        <div><span>02</span><strong>Settle</strong><small>Both lanes land on-chain</small><b>✓</b></div>
        <div><span>03</span><strong>Attack cap</strong><small>Second wallet stays WIDE</small><b>✓</b></div>
        <button onClick={onReplay} type="button">
          <span>{copied ? 'Copied' : 'Replay proof'}</span>
          <code>pnpm demo:sepolia</code>
        </button>
      </div>
    </section>
  );
}
