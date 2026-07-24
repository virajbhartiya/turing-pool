import type { CSSProperties } from 'react';

import { formatUnits } from '../lib/format';
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
            Every mined fill adds its executed input notional on-chain. A 1.0 tETH fill
            moves the schedule 10× as much as a 0.1 tETH fill; swap count is display-only.
          </p>
          <div className="controller-status"><i />on-chain · reprices after each fill</div>
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
            <span><i className="human" />{formatUnits(controller.tightVolume)} tETH verified</span>
            <span><i className="bot" />{formatUnits(controller.wideVolume)} tETH anonymous</span>
            <small>{controller.tightSwaps + controller.wideSwaps} fills · counts do not price fees</small>
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
        <div><span>01</span><strong>Pick size</strong><small>0.1 / 0.5 / 1.0 tETH</small><b>✓</b></div>
        <div><span>02</span><strong>Mine fill</strong><small>Aqua + SwapVM receipt</small><b>✓</b></div>
        <div><span>03</span><strong>Watch next fee</strong><small>Notional mix reprices on-chain</small><b>↻</b></div>
        <button onClick={onReplay} type="button">
          <span>{copied ? 'Copied' : 'Replay proof'}</span>
          <code>pnpm demo:world</code>
        </button>
      </div>
    </section>
  );
}
