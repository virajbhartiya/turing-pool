export function formatUnits(value: string | bigint, decimals = 18, maximumFractionDigits = 2): string {
  const amount = typeof value === 'bigint' ? value : BigInt(value);
  const precision = 10n ** BigInt(Math.max(0, decimals - 6));
  const sixDecimalNumber = Number(amount / precision) / 1e6;

  return sixDecimalNumber.toLocaleString('en-US', { maximumFractionDigits });
}

export function unitsAsNumber(value: string, decimals = 18): number {
  return Number(BigInt(value)) / 10 ** decimals;
}

export function compactUsd(value: number): string {
  return `$${Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)}`;
}

export function shortAddress(value?: string): string {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : '—';
}

export function transactionExplorer(chainId: number, transactionHash?: string): string | undefined {
  if (!transactionHash) return undefined;
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${transactionHash}`;
  if (chainId === 8453) return `https://basescan.org/tx/${transactionHash}`;
  return undefined;
}
