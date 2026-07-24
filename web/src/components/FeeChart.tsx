import type { FeeController, Swap } from '../types';

interface FeeChartProps {
  controller: FeeController;
  swaps: Swap[];
}

export function FeeChart({ controller, swaps }: FeeChartProps) {
  const chartMax = Math.max(40, Math.ceil(controller.wideFeeBps / 10) * 10);
  const plotted = swaps.slice(-16);
  const points = plotted.map((swap, index) => {
    const x = plotted.length < 2 ? 400 : 24 + index * (748 / (plotted.length - 1));
    const fee = Number(swap.feeBps);
    const y = 10 + (1 - Math.min(fee, chartMax) / chartMax) * 184;
    return { x, y, tight: swap.tight, hash: swap.transactionHash ?? `${index}` };
  });
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  const areaPath = points.length
    ? `${linePath} L ${points.at(-1)?.x.toFixed(1)} 208 L ${points[0]?.x.toFixed(1)} 208 Z`
    : '';
  const references = [
    { label: 'Bot', value: controller.wideFeeBps, tone: 'bot' },
    { label: 'LP target', value: controller.targetFeeBps, tone: 'target' },
    { label: 'Human', value: controller.tightFeeBps, tone: 'human' },
  ];

  return (
    <div className="fee-chart" aria-label="Observed fees and active fee schedule">
      <div className="chart-axis" aria-hidden="true">
        <span>{chartMax}</span>
        <span>{Math.round(chartMax * 0.75)}</span>
        <span>{Math.round(chartMax * 0.5)}</span>
        <span>{Math.round(chartMax * 0.25)}</span>
        <span>0 bps</span>
      </div>
      <svg viewBox="0 0 800 220" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="activity-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#58c8f4" stopOpacity=".38" />
            <stop offset="100%" stopColor="#58c8f4" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="fill-area" d={areaPath} />
        <path className="fill-line" d={linePath} />
        {points.map((point) => (
          <circle
            className={`fill-dot ${point.tight ? 'human' : 'bot'}`}
            cx={point.x}
            cy={point.y}
            key={point.hash}
            r="5"
          />
        ))}
      </svg>
      {references.map((reference) => (
        <div
          className={`chart-reference ${reference.tone}`}
          key={reference.label}
          style={{ top: `${8 + (1 - Math.min(reference.value, chartMax) / chartMax) * 78}%` }}
        >
          <span>{reference.label} · {reference.value} bps</span>
        </div>
      ))}
      <div className="chart-legend">
        <span><i className="human" />verified fill</span>
        <span><i className="bot" />anonymous fill</span>
        <span><i className="target" />LP target</span>
      </div>
    </div>
  );
}
