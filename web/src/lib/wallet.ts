export const WORLD_CHAIN_ID = 480;
export const WORLD_CHAIN_HEX = '0x1e0';

export interface Eip1193Provider {
  request(args: {
    method: string;
    params?: readonly unknown[] | Record<string, unknown>;
  }): Promise<unknown>;
  on?(event: 'accountsChanged' | 'chainChanged', listener: (value: unknown) => void): void;
  removeListener?(
    event: 'accountsChanged' | 'chainChanged',
    listener: (value: unknown) => void,
  ): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

interface ProviderError {
  code?: number;
  message?: string;
}

export function providerErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  return (error as ProviderError).code;
}

export function normalizeAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (account): account is string =>
      typeof account === 'string' && /^0x[0-9a-fA-F]{40}$/.test(account),
  );
}

export function parseChainId(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return undefined;
  return Number.parseInt(value.slice(2), 16);
}

export async function ensureWorldChain(provider: Eip1193Provider): Promise<void> {
  const current = parseChainId(await provider.request({ method: 'eth_chainId' }));
  if (current === WORLD_CHAIN_ID) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: WORLD_CHAIN_HEX }],
    });
  } catch (error) {
    if (providerErrorCode(error) !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: WORLD_CHAIN_HEX,
          chainName: 'World Chain',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://worldchain-mainnet.g.alchemy.com/public'],
          blockExplorerUrls: ['https://worldscan.org'],
        },
      ],
    });
  }
}

export async function sendWalletTransaction(
  provider: Eip1193Provider,
  transaction: { from: string; to: string; data: string; value: string },
): Promise<string> {
  const hash = await provider.request({
    method: 'eth_sendTransaction',
    params: [transaction],
  });
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error('wallet returned an invalid transaction hash');
  }
  return hash;
}

export async function waitForWalletReceipt(
  provider: Eip1193Provider,
  transactionHash: string,
  timeoutMs = 180_000,
): Promise<{ blockNumber: string; status: string }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [transactionHash],
    });
    if (typeof receipt === 'object' && receipt !== null) {
      const candidate = receipt as { blockNumber?: unknown; status?: unknown };
      if (typeof candidate.blockNumber === 'string' && typeof candidate.status === 'string') {
        if (candidate.status !== '0x1') {
          throw new Error(`transaction reverted: ${transactionHash}`);
        }
        return { blockNumber: candidate.blockNumber, status: candidate.status };
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  throw new Error(`transaction confirmation timed out: ${transactionHash}`);
}
