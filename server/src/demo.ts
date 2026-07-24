export const DEFAULT_QUOTE_AMOUNT = 10n ** 18n;
export const MAX_QUOTE_AMOUNT = 10n ** 36n;

export function parseQuoteAmount(value: string | undefined): bigint {
  if (value === undefined) return DEFAULT_QUOTE_AMOUNT;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error('amountIn must be a positive base-10 integer');
  }
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error('amountIn must be greater than zero');
  if (amount > MAX_QUOTE_AMOUNT) {
    throw new Error(`amountIn exceeds the maximum supported value (${MAX_QUOTE_AMOUNT})`);
  }
  return amount;
}

export function amountForOverQuotaQuote(remaining: bigint): bigint {
  return remaining + 1n;
}

export interface RuntimeDescription {
  mode: 'local' | 'base-fork' | 'base' | 'chain';
  label: string;
  agentBook: 'mock' | 'fork-injected' | 'live';
}

export function classifyRuntime(
  chainId: number,
  mockAgentBook: boolean,
  rpcUrl = 'http://127.0.0.1:8545',
): RuntimeDescription {
  const localRpc = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(rpcUrl);

  if (mockAgentBook) {
    if (!localRpc) {
      const network =
        chainId === 84532 ? 'Base Sepolia' : chainId === 8453 ? 'Base mainnet' : `Chain ${chainId}`;
      return {
        mode: 'chain',
        label: `${network} · test AgentBook`,
        agentBook: 'mock',
      };
    }
    return {
      mode: 'local',
      label: 'Local Anvil · mock AgentBook',
      agentBook: 'mock',
    };
  }
  if (localRpc) {
    return {
      mode: 'base-fork',
      label: 'Base fork · real AgentBook bytecode',
      agentBook: 'fork-injected',
    };
  }
  if (chainId === 8453) {
    return {
      mode: 'base',
      label: 'Base mainnet',
      agentBook: 'live',
    };
  }
  if (chainId === 480) {
    return {
      mode: 'chain',
      label: 'World Chain · canonical AgentBook',
      agentBook: 'live',
    };
  }
  return {
    mode: 'chain',
    label: `Chain ${chainId}`,
    agentBook: 'live',
  };
}
