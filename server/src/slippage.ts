export const DEFAULT_SLIPPAGE_BPS = 50;

/** JSON callers must provide integer basis points; omission is explicitly 0.5%. */
export function parseSlippageBps(value: unknown = DEFAULT_SLIPPAGE_BPS): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= 10_000) {
    throw new Error('slippageBps must be an integer between 0 and 9999');
  }
  return value;
}

export function minimumOutput(quotedAmount: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS): bigint {
  if (quotedAmount < 0n) throw new Error('Quoted amount must not be negative');
  return quotedAmount * BigInt(10_000 - parseSlippageBps(slippageBps)) / 10_000n;
}
