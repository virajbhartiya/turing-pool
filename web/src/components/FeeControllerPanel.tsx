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
          <h2>Two live rates. One LP target.</h2>
          <p>
            Both rates move after every mined fill. Bot volume deepens the human
            discount; human volume raises both lanes while the weighted LP rate stays
            at {controller.targetFeeBps} bps.
          </p>
          <div className="controller-actions">
            <div className="controller-status"><i />on-chain · reprices after each fill</div>
            <button className="replay-button" onClick={onReplay} type="button">
              <span>{copied ? 'Command copied' : 'Copy replay command'}</span>
              <code>pnpm demo:world</code>
            </button>
          </div>
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

    </section>
  );
}
