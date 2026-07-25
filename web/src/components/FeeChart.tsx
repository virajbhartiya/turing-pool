import { unitsAsNumber } from '../lib/format';
import type { FeeController, Pool, Swap } from '../types';

export type MarketChartMode = 'price' | 'fee';

interface FeeChartProps {
  controller: FeeController;
  swaps: Swap[];
  pool: Pool;
  mode: MarketChartMode;
}

interface ChartPoint {
  x: number;
  y: number;
  tight: boolean;
  hash: string;
}

function pathFor(points: ChartPoint[]): { line: string; area: string } {
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  const area = points.length
    ? `${line} L ${points.at(-1)?.x.toFixed(1)} 208 L ${points[0]?.x.toFixed(1)} 208 Z`
    : '';
  return { line, area };
}

function xFor(index: number, count: number): number {
  return count < 2 ? 400 : 24 + index * (748 / (count - 1));
}

function executionPrice(swap: Swap, pool: Pool): number | undefined {
  const input = unitsAsNumber(swap.amountIn);
  const output = unitsAsNumber(swap.amountOut);
  if (input <= 0 || output <= 0) return undefined;
  return swap.tokenIn.toLowerCase() === pool.token0.toLowerCase()
    ? output / input
    : input / output;
}

function PriceChart({ swaps, pool }: { swaps: Swap[]; pool: Pool }) {
  const observations = swaps
    .slice(-24)
    .map((swap) => ({ swap, price: executionPrice(swap, pool) }))
    .filter((entry): entry is { swap: Swap; price: number } =>
      entry.price !== undefined && Number.isFinite(entry.price),
    );
  const prices = observations.map((entry) => entry.price);
  const rawMin = prices.length ? Math.min(...prices) : 0;
  const rawMax = prices.length ? Math.max(...prices) : 1;
  const center = prices.length ? (rawMin + rawMax) / 2 : 0;
  const padding = Math.max((rawMax - rawMin) * 0.18, center * 0.0005, 0.01);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const spread = Math.max(max - min, 0.01);
  const points = observations.map(({ swap, price }, index) => ({
    x: xFor(index, observations.length),
    y: 12 + ((max - price) / spread) * 180,
    tight: swap.tight,
    hash: swap.transactionHash ?? `${swap.blockNumber}-${index}`,
  }));
  const paths = pathFor(points);
  const ticks = Array.from({ length: 5 }, (_, index) => max - (spread * index) / 4);
  const latest = prices.at(-1);

  return (
    <div className="fee-chart price-chart" aria-label="Realized tETH price from mined swaps">
      <div className="chart-axis price-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick}>{tick.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
        ))}
      </div>
      <svg viewBox="0 0 800 220" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="price-activity-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#24c1ac" stopOpacity=".28" />
            <stop offset="100%" stopColor="#24c1ac" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="fill-area price-area" d={paths.area} />
        <path className="fill-line price-line" d={paths.line} />
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
      {latest !== undefined && (
        <div
          className="chart-reference price"
          style={{ top: `${8 + ((max - latest) / spread) * 78}%` }}
        >
          <span>Last · {latest.toLocaleString('en-US', { maximumFractionDigits: 2 })} tUSD</span>
        </div>
      )}
      <div className="chart-legend">
        <span><i className="human" />verified fill</span>
        <span><i className="bot" />searcher fill</span>
        <span>{observations.length} mined price observations</span>
      </div>
    </div>
  );
}

function AdaptiveFeeChart({
  controller,
  swaps,
}: {
  controller: FeeController;
  swaps: Swap[];
}) {
  const chartMax = Math.max(40, Math.ceil(controller.wideFeeBps / 10) * 10);
  const plotted = swaps.slice(-24);
  const points = plotted.map((swap, index) => {
    const fee = Number(swap.feeBps);
    return {
      x: xFor(index, plotted.length),
      y: 10 + (1 - Math.min(fee, chartMax) / chartMax) * 184,
      tight: swap.tight,
      hash: swap.transactionHash ?? `${swap.blockNumber}-${index}`,
    };
  });
  const paths = pathFor(points);
  const references = [
    { label: 'Searcher', value: controller.wideFeeBps, tone: 'bot' },
    { label: 'LP target', value: controller.targetFeeBps, tone: 'target' },
    { label: 'Human-backed', value: controller.tightFeeBps, tone: 'human' },
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
            <stop offset="0%" stopColor="#e8933a" stopOpacity=".28" />
            <stop offset="100%" stopColor="#e8933a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="fill-area" d={paths.area} />
        <path className="fill-line" d={paths.line} />
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
        <span><i className="human" />human-backed fill</span>
        <span><i className="bot" />searcher fill</span>
        <span><i className="target" />LP target</span>
      </div>
    </div>
  );
}

export function FeeChart({ controller, swaps, pool, mode }: FeeChartProps) {
  return mode === 'price' ? (
    <PriceChart pool={pool} swaps={swaps} />
  ) : (
    <AdaptiveFeeChart controller={controller} swaps={swaps} />
  );
}
