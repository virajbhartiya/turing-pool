import { parseUnits } from './format';

export interface StrategyDraft {
  amount: string;
  direction: 'tUSD-to-tETH' | 'tETH-to-tUSD';
  slices: string;
  maxFee: string;
  maxDispersion: string;
  maxUnverifiedFlow: string;
  expiresInHours: string;
}

export const DEFAULT_STRATEGY_DRAFT: StrategyDraft = {
  amount: '500', direction: 'tUSD-to-tETH', slices: '5',
  maxFee: '0.35', maxDispersion: '1.50', maxUnverifiedFlow: '65', expiresInHours: '24',
};

function bounded(value: string, name: string, min: number, max: number, scale = 1) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`Enter a valid ${name}.`);
  const result = Number(value) * scale;
  if (!Number.isFinite(result) || Math.abs(result - Math.round(result)) > 1e-8 || result < min || result > max) {
    throw new Error(`${name} must be between ${min / scale} and ${max / scale}${scale === 100 ? '%' : ''}.`);
  }
  return Math.round(result);
}

export function buildStrategyDraft(draft: StrategyDraft) {
  const totalAmount = parseUnits(draft.amount);
  const slices = bounded(draft.slices, 'Trades', 1, 20);
  if (BigInt(totalAmount) / BigInt(slices) === 0n) throw new Error('Each trade must contain at least one token unit.');
  const maxFeeBps = bounded(draft.maxFee, 'Maximum fee', 1, 250, 100);
  const maxPriceGapBps = bounded(draft.maxDispersion, 'Maximum dispersion', 5, 2000, 100);
  const maxBotShareBps = bounded(draft.maxUnverifiedFlow, 'Maximum unverified flow', 500, 9500, 100);
  const expiresInHours = bounded(draft.expiresInHours, 'Expiry', 1, 168);
  const input = draft.direction === 'tUSD-to-tETH' ? 'tUSD' : 'tETH';
  const output = input === 'tUSD' ? 'tETH' : 'tUSD';
  return {
    prompt: `Convert ${draft.amount} ${input} to ${output} in ${slices} slices when bot activity is below ${draft.maxUnverifiedFlow}%, fee is under ${maxFeeBps} bps, and execution dispersion is below ${maxPriceGapBps} bps.`,
    direction: draft.direction, totalAmount, slices, maxFeeBps, maxPriceGapBps, maxBotShareBps, expiresInHours,
  };
}

export type StrategyDraftIntent = ReturnType<typeof buildStrategyDraft>;
