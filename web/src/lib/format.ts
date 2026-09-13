export function formatUnits(value: string | bigint, decimals = 18, maximumFractionDigits = 2): string {
  const amount = typeof value === 'bigint' ? value : BigInt(value);
  const precision = 10n ** BigInt(Math.max(0, decimals - 6));
  const sixDecimalNumber = Number(amount / precision) / 1e6;

  return sixDecimalNumber.toLocaleString('en-US', { maximumFractionDigits });
}

export function formatSignedUnits(
  value: string | bigint,
  decimals = 18,
  maximumFractionDigits = 2,
): string {
  const amount = typeof value === 'bigint' ? value : BigInt(value);
  const sign = amount > 0n ? '+' : amount < 0n ? '-' : '';
  const magnitude = amount < 0n ? -amount : amount;
  return `${sign}${formatUnits(magnitude, decimals, maximumFractionDigits)}`;
}

export function unitsAsNumber(value: string, decimals = 18): number {
  return Number(BigInt(value)) / 10 ** decimals;
}

export function parseUnits(value: string, decimals = 18): string {
  const normalized = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(normalized)) {
    throw new Error('Enter a valid positive token amount.');
  }
  const [whole = '0', fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`This token supports at most ${decimals} decimal places.`);
  }
  const units =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (units <= 0n) throw new Error('Amount must be greater than zero.');
  return units.toString();
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
  if (chainId === 31337) return `/demo/transactions/${transactionHash}`;
  if (chainId === 480) return `https://worldscan.org/tx/${transactionHash}`;
  return `https://blockscan.com/tx/${transactionHash}`;
}

export function addressExplorer(chainId: number, address?: string): string | undefined {
  if (!address) return undefined;
  if (chainId === 480) return `https://worldscan.org/address/${address}`;
  return `https://blockscan.com/address/${address}`;
}
