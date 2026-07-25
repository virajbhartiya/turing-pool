export const DEFAULT_QUOTE_AMOUNT = 10n ** 18n;
export const MAX_QUOTE_AMOUNT = 10n ** 36n;
export type DemoTradeDirection = 'tETH-to-tUSD' | 'tUSD-to-tETH';

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

export function parseDemoTradeDirection(value: unknown): DemoTradeDirection {
  if (value === undefined) return 'tETH-to-tUSD';
  if (value === 'tETH-to-tUSD' || value === 'tUSD-to-tETH') return value;
  throw new Error('direction must be "tETH-to-tUSD" or "tUSD-to-tETH"');
}

export type TradeErrorCode =
  | 'rpc_rate_limited'
  | 'network_error'
  | 'trade_busy'
  | 'execution_unavailable'
  | 'invalid_trade_request'
  | 'trade_forbidden'
  | 'trade_failed';

export interface TradeErrorDescription {
  code: TradeErrorCode;
  error: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  status: 400 | 403 | 429 | 500 | 503;
}

function errorDescription(error: unknown): string {
  if (error instanceof Error) {
    const cause = 'cause' in error ? error.cause : undefined;
    return `${error.name}: ${error.message}${cause ? ` ${errorDescription(cause)}` : ''}`;
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;
    return ['message', 'shortMessage', 'details', 'status', 'code', 'cause']
      .map((key) => candidate[key])
      .filter((value) => value !== undefined)
      .map(errorDescription)
      .join(' ');
  }
  return String(error);
}

/**
 * Convert internal wallet/RPC failures into a small public error contract.
 * Raw provider URLs, calldata, private configuration, and viem diagnostics must
 * stay in server logs rather than being serialized into the trading terminal.
 */
export function describeTradeError(
  error: unknown,
): TradeErrorDescription {
  const description = errorDescription(error);

  if (/(?:\b429\b|too many requests|rate[ -]?limit|compute units per second)/i.test(description)) {
    return {
      code: 'rpc_rate_limited',
      error:
        'World Chain RPC is temporarily busy. No confirmed result was received; check the explorer before retrying.',
      retryable: true,
      retryAfterSeconds: 5,
      status: 503,
    };
  }

  if (/already in progress|wait before submitting/i.test(description)) {
    return {
      code: 'trade_busy',
      error:
        'A trade for this lane is already being processed. No additional transaction was submitted.',
      retryable: true,
      retryAfterSeconds: 4,
      status: 429,
    };
  }

  if (
    /TransactionReceiptNotFoundError|transaction receipt.*(?:could not be found|not found)|timed out.*transaction receipt|waitForTransactionReceipt/i.test(
      description,
    )
  ) {
    return {
      code: 'network_error',
      error:
        'The transaction is not visible to the backend RPC yet. It may already be mined; check Worldscan before retrying.',
      retryable: true,
      retryAfterSeconds: 5,
      status: 503,
    };
  }

  if (/server-operated market trades are disabled|not configured|signing key resolves to/i.test(description)) {
    return {
      code: 'execution_unavailable',
      error: 'Server-operated on-chain execution is not available for this runtime.',
      retryable: false,
      status: 503,
    };
  }

  if (/amountIn must be between/i.test(description)) {
    return {
      code: 'invalid_trade_request',
      error: 'amountIn exceeds the configured execution limit for this direction.',
      retryable: false,
      status: 400,
    };
  }

  return {
    code: 'trade_failed',
    error:
      'The trade could not be completed safely. Check on-chain activity before trying again.',
    retryable: false,
    status: 500,
  };
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
        chainId === 84532 ? 'Execution testnet' : chainId === 8453 ? 'Base mainnet' : `Chain ${chainId}`;
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
