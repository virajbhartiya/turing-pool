import { formatUnits } from '../lib/format';
import type { FeeController } from '../types';

interface FeeControllerPanelProps {
  controller: FeeController;
}

export function FeeControllerPanel({ controller }: FeeControllerPanelProps) {
  const humanShare = controller.humanShareBps / 100;
  const botShare = 100 - humanShare;

  return (
    <section className="controller-section" id="risk">
      <div className="controller-panel lean-controller">
        <div className="controller-copy compact">
          <span>Activity-priced fee controller</span>
          <h2>Two live rates. One LP target.</h2>
          <small>{formatUnits(controller.tightVolume)} tETH verified · {formatUnits(controller.wideVolume)} tETH anonymous</small>
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
