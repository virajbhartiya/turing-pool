import { createHash, randomUUID } from 'node:crypto';

export type AutopilotDirection = 'tETH-to-tUSD' | 'tUSD-to-tETH';
export type AutopilotStatus = 'draft' | 'active' | 'paused' | 'completed';

export interface AutopilotIntent {
  prompt: string;
  owner?: string;
  direction?: AutopilotDirection;
  totalAmount?: string;
  slices?: number;
  maxBotShareBps?: number;
  maxFeeBps?: number;
  maxPriceGapBps?: number;
  expiresInHours?: number;
}

export interface AutopilotEvidence {
  source: 'nuthatch' | 'snapshot' | 'chain-events';
  indexedBlock: string | null;
  observedAt: string;
  fills: number;
  tightShareBps: number;
  botShareBps: number;
  currentTightFeeBps: number;
  currentWideFeeBps: number;
  averageExecutionPrice: number;
  priceGapBps: number;
  lagBlocks: number;
  available: boolean;
  provenance: string;
}

export interface AutopilotCheck {
  key: 'identity' | 'indexer' | 'bot-share' | 'fee' | 'price-gap' | 'expiry';
  label: string;
  value: string;
  limit: string;
  passed: boolean;
}

export interface AutopilotPlan {
  id: string;
  version: 1;
  strategy: 'conditional-dca';
  title: string;
  prompt: string;
  owner: string | null;
  status: AutopilotStatus;
  direction: AutopilotDirection;
  inputToken: 'tETH' | 'tUSD';
  outputToken: 'tETH' | 'tUSD';
  totalAmount: string;
  sliceAmount: string;
  slices: number;
  executedSlices: number;
  remainingAmount: string;
  executions: Array<{
    slice: number;
    amountIn: string;
    transactionHash: string;
    confirmedAt: string;
  }>;
  conditions: {
    maxBotShareBps: number;
    maxFeeBps: number;
    maxPriceGapBps: number;
  };
  createdAt: string;
  expiresAt: string;
  decision: 'execute' | 'wait' | 'paused' | 'complete';
  decisionSummary: string;
  checks: AutopilotCheck[];
  evidence: AutopilotEvidence;
  decisionHash: string;
}

const TOKEN_SCALE = 10n ** 18n;
const DEFAULT_TOTAL_TUSD = 500n * TOKEN_SCALE;
const DEFAULT_TOTAL_TETH = TOKEN_SCALE;

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function parseAmount(value: unknown, fallback: bigint): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback;
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > 100_000n * TOKEN_SCALE) return fallback;
  return parsed;
}

function promptNumber(prompt: string, pattern: RegExp): number | undefined {
  const match = prompt.match(pattern);
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function promptAmount(prompt: string, symbol: 'tETH' | 'tUSD'): bigint | undefined {
  const parsed = promptNumber(prompt, new RegExp(`(?:^|\\s)([\\d,.]+)\\s*${symbol}`, 'i'));
  if (parsed === undefined || parsed <= 0 || parsed > 100_000) return undefined;
  return BigInt(Math.round(parsed * 1_000_000)) * 10n ** 12n;
}

function decisionFor(
  status: AutopilotStatus,
  evidence: AutopilotEvidence,
  checks: AutopilotCheck[],
): Pick<AutopilotPlan, 'decision' | 'decisionSummary'> {
  if (status === 'paused') {
    return { decision: 'paused', decisionSummary: 'Human control is paused. No execution can occur.' };
  }
  if (status === 'completed') {
    return { decision: 'complete', decisionSummary: 'Every scheduled slice has been executed.' };
  }
  if (!evidence.available) {
    return {
      decision: 'wait',
      decisionSummary: 'Live market evidence is unavailable, so the agent fails closed.',
    };
  }
  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    return {
      decision: 'wait',
      decisionSummary: `Waiting: ${failed.map((check) => check.label.toLowerCase()).join(', ')} outside policy.`,
    };
  }
  return {
    decision: 'execute',
    decisionSummary: 'All live risk checks pass. The next Aqua slice is executable.',
  };
}

export function buildAutopilotPlan(
  intent: AutopilotIntent,
  evidence: AutopilotEvidence,
  now = new Date(),
): AutopilotPlan {
  if (intent.direction !== undefined && intent.direction !== 'tETH-to-tUSD' && intent.direction !== 'tUSD-to-tETH') {
    throw new Error('Invalid strategy direction.');
  }
  if (intent.slices !== undefined && (!Number.isSafeInteger(intent.slices) || intent.slices < 1 || intent.slices > 20)) {
    throw new Error('Strategy slices must be an integer from 1 to 20.');
  }
  const prompt = intent.prompt.trim().slice(0, 600) ||
    'Convert 500 tUSD to tETH in five slices when market risk is acceptable.';
  const direction: AutopilotDirection = intent.direction ??
    (/sell|teth\s+(?:to|into)\s+tusd/i.test(prompt) ? 'tETH-to-tUSD' : 'tUSD-to-tETH');
  const inputToken = direction === 'tUSD-to-tETH' ? 'tUSD' : 'tETH';
  const outputToken = direction === 'tUSD-to-tETH' ? 'tETH' : 'tUSD';
  const amountFromPrompt = promptAmount(prompt, inputToken);
  const totalAmount = parseAmount(
    intent.totalAmount,
    amountFromPrompt ?? (inputToken === 'tUSD' ? DEFAULT_TOTAL_TUSD : DEFAULT_TOTAL_TETH),
  );
  const slicesFromPrompt = promptNumber(prompt, /(\d+)\s*(?:slices|trades|orders)/i);
  const slices = boundedInteger(intent.slices ?? slicesFromPrompt, 5, 1, 20);
  const maxBotFromPrompt = promptNumber(
    prompt,
    /(?:bot|toxic|searcher)[^\d]{0,24}(\d+(?:\.\d+)?)\s*%/i,
  );
  const maxFeeFromPrompt = promptNumber(prompt, /(?:fee|cost)[^\d]{0,18}(\d+)\s*bps/i);
  const maxPriceGapFromPrompt = promptNumber(
    prompt,
    /(?:dispersion|price gap|spread)[^\d]{0,24}(\d+)\s*bps/i,
  );
  const maxBotShareBps = boundedInteger(
    intent.maxBotShareBps ?? (maxBotFromPrompt === undefined ? undefined : Math.round(maxBotFromPrompt * 100)),
    5_000,
    500,
    9_500,
  );
  const maxFeeBps = boundedInteger(intent.maxFeeBps ?? maxFeeFromPrompt, 35, 1, 250);
  const maxPriceGapBps = boundedInteger(
    intent.maxPriceGapBps ?? maxPriceGapFromPrompt,
    150,
    5,
    2_000,
  );
  const expiresInHours = boundedInteger(intent.expiresInHours, 24, 1, 168);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + expiresInHours * 3_600_000).toISOString();
  const sliceAmount = totalAmount / BigInt(slices);
  if (sliceAmount === 0n) throw new Error('Each strategy slice must contain at least one token unit.');
  const status: AutopilotStatus = 'draft';
  const checks: AutopilotCheck[] = [
    {
      key: 'identity',
      label: 'Human-backed agent',
      value: intent.owner ? 'wallet connected' : 'connect required',
      limit: 'AgentBook identity',
      passed: Boolean(intent.owner),
    },
    {
      key: 'indexer',
      label: 'Nuthatch evidence',
      value: evidence.available ? `block ${evidence.indexedBlock ?? 'live'}` : 'unavailable',
      limit: 'live and provenance-bound',
      passed: evidence.available,
    },
    {
      key: 'bot-share',
      label: 'Searcher flow',
      value: `${(evidence.botShareBps / 100).toFixed(1)}%`,
      limit: `≤ ${(maxBotShareBps / 100).toFixed(1)}%`,
      passed: evidence.botShareBps <= maxBotShareBps,
    },
    {
      key: 'fee',
      label: 'Execution fee',
      value: `${evidence.currentTightFeeBps} bps`,
      limit: `≤ ${maxFeeBps} bps`,
      passed: evidence.currentTightFeeBps <= maxFeeBps,
    },
    {
      key: 'price-gap',
      label: 'Execution dispersion',
      value: `${evidence.priceGapBps.toFixed(1)} bps`,
      limit: `≤ ${maxPriceGapBps} bps`,
      passed: evidence.priceGapBps <= maxPriceGapBps,
    },
    {
      key: 'expiry',
      label: 'Strategy window',
      value: 'active',
      limit: new Date(expiresAt).toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC',
      passed: true,
    },
  ];
  const decision = decisionFor(status, evidence, checks);
  const decisionPayload = JSON.stringify({
    version: 1,
    direction,
    totalAmount: totalAmount.toString(),
    slices,
    maxBotShareBps,
    maxFeeBps,
    maxPriceGapBps,
    indexedBlock: evidence.indexedBlock,
    provenance: evidence.provenance,
    decision: decision.decision,
  });

  return {
    id: randomUUID(),
    version: 1,
    strategy: 'conditional-dca',
    title: 'Conditional DCA',
    prompt,
    owner: intent.owner?.toLowerCase() ?? null,
    status,
    direction,
    inputToken,
    outputToken,
    totalAmount: totalAmount.toString(),
    sliceAmount: sliceAmount.toString(),
    slices,
    executedSlices: 0,
    remainingAmount: totalAmount.toString(),
    executions: [],
    conditions: { maxBotShareBps, maxFeeBps, maxPriceGapBps },
    createdAt,
    expiresAt,
    ...decision,
    checks,
    evidence,
    decisionHash: `0x${createHash('sha256').update(decisionPayload).digest('hex')}`,
  };
}

export function updateAutopilotPlan(
  plan: AutopilotPlan,
  evidence: AutopilotEvidence,
  status = plan.status,
  now = new Date(),
): AutopilotPlan {
  const expired = now.getTime() >= new Date(plan.expiresAt).getTime();
  const executedSlices = Math.min(plan.executedSlices, plan.slices);
  const nextStatus: AutopilotStatus = executedSlices >= plan.slices
    ? 'completed'
    : status;
  const checks = plan.checks.map((check) => {
    if (check.key === 'indexer') {
      return {
        ...check,
        value: evidence.available ? `block ${evidence.indexedBlock ?? 'live'}` : 'unavailable',
        passed: evidence.available,
      };
    }
    if (check.key === 'bot-share') {
      return {
        ...check,
        value: `${(evidence.botShareBps / 100).toFixed(1)}%`,
        passed: evidence.botShareBps <= plan.conditions.maxBotShareBps,
      };
    }
    if (check.key === 'fee') {
      return {
        ...check,
        value: `${evidence.currentTightFeeBps} bps`,
        passed: evidence.currentTightFeeBps <= plan.conditions.maxFeeBps,
      };
    }
    if (check.key === 'price-gap') {
      return {
        ...check,
        value: `${evidence.priceGapBps.toFixed(1)} bps`,
        passed: evidence.priceGapBps <= plan.conditions.maxPriceGapBps,
      };
    }
    if (check.key === 'expiry') {
      return { ...check, value: expired ? 'expired' : 'active', passed: !expired };
    }
    return check;
  });
  const decision = decisionFor(nextStatus, evidence, checks);
  const remainingAmount = BigInt(plan.totalAmount) - plan.executions.reduce((sum, execution) => sum + BigInt(execution.amountIn), 0n);
  const sliceAmount = executedSlices === plan.slices - 1
    ? remainingAmount
    : BigInt(plan.totalAmount) / BigInt(plan.slices);
  const updated = {
    ...plan,
    status: nextStatus,
    executedSlices,
    remainingAmount: (remainingAmount > 0n ? remainingAmount : 0n).toString(),
    sliceAmount: (sliceAmount > 0n ? sliceAmount : 0n).toString(),
    evidence,
    checks,
    ...decision,
  };
  updated.decisionHash = `0x${createHash('sha256').update(JSON.stringify({
    id: updated.id, owner: updated.owner, status: updated.status, direction: updated.direction,
    totalAmount: updated.totalAmount, slices: updated.slices, executedSlices,
    conditions: updated.conditions, expiresAt: updated.expiresAt, evidence,
    checks, decision: updated.decision,
  })).digest('hex')}`;
  return updated;
}
