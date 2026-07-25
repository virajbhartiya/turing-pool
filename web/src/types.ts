export interface Runtime {
  mode: 'chain' | 'hosted-preview' | 'local' | 'base-fork' | 'base';
  label: string;
  agentBook: string;
  chainId: number;
  latestBlock: string;
  rpcStatus: string;
}

export interface Contracts {
  aqua: string;
  agentBook: string;
  app: string;
  router: string;
  quota: string;
  mockAgentBook: boolean;
}

export interface Pool {
  strategyHash: string;
  token0: string;
  token1: string;
  balance0: string;
  balance1: string;
  tightFeeBps: string;
  wideFeeBps: string;
}

export interface FeeController {
  tightFeeBps: number;
  wideFeeBps: number;
  targetFeeBps: number;
  projectedWeightedFeeBps: number;
  revenueDeltaBps: number;
  humanShareBps: number;
  tightVolume: string;
  wideVolume: string;
  status: string;
  canAdjust: boolean;
  formula: string;
  observedSwaps: number;
  tightSwaps: number;
  wideSwaps: number;
  normalization: string;
  source: 'event-derived-recommendation' | 'on-chain-volume-controller';
}

export interface Swap {
  blockNumber: string;
  transactionHash?: string;
  taker: string;
  humanId: string;
  tight: boolean;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  feeBps: string;
  source?: 'aqua-app' | 'swapvm';
}

export interface Execution {
  enabled: boolean;
  venue: 'SwapVM';
  opcode: number;
  instruction: '_humanGate';
  event: 'HumanGated';
  router: string;
  humanWallet: string;
  botWallet: string;
  tightFeeBps: number;
  wideFeeBps: number;
  feeSource?: string;
  repricesAfter?: string;
}

export interface StrategyHistoryEntry {
  blockNumber: string;
  transactionHash?: string;
  strategyHash: string;
  active: boolean;
  kind: 'initial-ship' | 'repriced';
  from: { tightFeeBps: string; wideFeeBps: string } | null;
  to: { tightFeeBps: string; wideFeeBps: string };
}

export interface DataSource {
  name: string;
  status: string;
  [key: string]: unknown;
}

export interface ActivityDataSource extends DataSource {
  configured?: boolean;
  endpoint?: string | null;
  mode?: 'sql+mcp' | 'graphql' | 'chain-events';
  indexedBlock?: string | null;
  sealedThrough?: string | null;
  lagBlocks?: number;
  registryHash?: string | null;
  provenance?: string;
  fallback?: string | null;
  error?: string;
  summary?: {
    fills: number;
    tightFills: number;
    wideFills: number;
    tightVolume: string;
    wideVolume: string;
    humanShareBps: number;
    indexedTradeBlock: string | null;
  };
}

export interface ProtocolState {
  runtime: Runtime;
  contracts: Contracts;
  execution?: Execution;
  pool: Pool;
  feeController: FeeController;
  stats: {
    totalSwaps: number;
    tightSwaps: number;
    wideSwaps: number;
  };
  demoHuman: {
    humanId: string;
    quotaRemainingToken0: string;
    quotaRemainingToken1: string;
    dailyCapToken0: string;
    dailyCapToken1: string;
  };
  swaps: Swap[];
  strategyHistory: StrategyHistoryEntry[];
  dataSources: {
    quotes: DataSource;
    strategy: DataSource & { historyEntries?: number };
    activity: ActivityDataSource;
    strategist: DataSource & {
      configured?: boolean;
      indexedBlock?: string | null;
      hasIndexingErrors?: boolean | null;
      error?: string;
    };
  };
}

export type DemoTradeLane = 'human' | 'bot';
export type DemoTradeDirection = 'tETH-to-tUSD' | 'tUSD-to-tETH';
export type DemoTokenSymbol = 'tETH' | 'tUSD';

export type DemoTradeErrorCode =
  | 'rpc_rate_limited'
  | 'trade_busy'
  | 'execution_unavailable'
  | 'trade_failed'
  | 'invalid_trade_request'
  | 'trade_forbidden'
  | 'network_error';

export interface DemoTradeError {
  code: DemoTradeErrorCode;
  error: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  status: number;
}

export interface DemoTradeResult {
  lane: DemoTradeLane;
  direction: DemoTradeDirection;
  zeroForOne: boolean;
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol: DemoTokenSymbol;
  tokenOutSymbol: DemoTokenSymbol;
  wallet: string;
  transactionHash: string;
  approvalTransactionHash?: string;
  blockNumber: string;
  amountIn: string;
  amountOut: string;
  orderHash: string;
  opcode: number;
  event: 'HumanGated';
  humanId: string;
  humanBacked: boolean;
  tight: boolean;
  tier: 'tight' | 'wide';
  feeBps: number;
  quotedFeeSchedule: {
    tightFeeBps: string;
    wideFeeBps: string;
    targetFeeBps: string;
    humanShareBps: string;
    tightVolume: string;
    wideVolume: string;
  };
  explorerUrl: string;
}

export interface DemoQuote {
  amountIn: string;
  amountOut: string;
  feeBps: number;
  tier: 'tight' | 'wide';
  direction?: DemoTradeDirection;
  zeroForOne?: boolean;
  tokenIn?: string;
  tokenOut?: string;
  tokenInSymbol?: DemoTokenSymbol;
  tokenOutSymbol?: DemoTokenSymbol;
}

export interface DemoQuotes {
  mode?: string;
  direction?: DemoTradeDirection;
  zeroForOne?: boolean;
  tokenIn?: string;
  tokenOut?: string;
  tokenInSymbol?: DemoTokenSymbol;
  tokenOutSymbol?: DemoTokenSymbol;
  feeSchedule?: {
    tightFeeBps: string;
    wideFeeBps: string;
    targetFeeBps: string;
    humanShareBps: string;
    tightVolume: string;
    wideVolume: string;
  };
  human: DemoQuote;
  bot: DemoQuote;
  sybil: DemoQuote & {
    sharedQuotaRemaining: string;
  };
  rationale: string;
  improvementBps?: number;
}
