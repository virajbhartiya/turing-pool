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
  vaultFactory?: string;
  vaultRouter?: string;
  demoVault?: string;
  demoVaultQuota?: string;
  identityMirror?: string;
  identityMode?: 'world-agentbook-mirror';
  identitySourceAgentBook?: string;
  identitySourceBlock?: string;
  identitySourceChainId?: number;
  faucet?: string;
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
  | 'insufficient_balance'
  | 'trade_failed'
  | 'invalid_trade_request'
  | 'trade_forbidden'
  | 'wallet_unavailable'
  | 'wallet_rejected'
  | 'wrong_network'
  | 'network_error';

export interface DemoTradeError {
  code: DemoTradeErrorCode;
  error: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  status: number;
}

export type DemoTradeProgressStage =
  | 'wallet'
  | 'identity'
  | 'allowance'
  | 'simulation'
  | 'submission'
  | 'settlement'
  | 'receipt'
  | 'repricing'
  | 'refresh';

export interface DemoTradeQuery {
  kind: 'wallet' | 'read' | 'simulate' | 'write' | 'receipt' | 'index';
  method: string;
  target: string;
  result?: string;
  calldata?: string;
}

export interface DemoTradeProgress {
  stage: DemoTradeProgressStage;
  status: 'active' | 'complete' | 'error';
  title: string;
  detail: string;
  transactionHash?: string;
  queries?: DemoTradeQuery[];
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

export interface ConnectedWalletQuote {
  wallet: string;
  chainId: number;
  direction: DemoTradeDirection;
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol: DemoTokenSymbol;
  tokenOutSymbol: DemoTokenSymbol;
  amountIn: string;
  amountOut: string;
  balance: string;
  allowance: string;
  humanId: string;
  humanBacked: boolean;
  tight: boolean;
  tier: 'tight' | 'wide';
  feeBps: number;
  sufficientBalance: boolean;
  requiresApproval: boolean;
  router: string;
  feeSchedule: {
    tightFeeBps: string;
    wideFeeBps: string;
    targetFeeBps: string;
    humanShareBps: string;
    tightVolume: string;
    wideVolume: string;
  };
}

export interface PreparedWalletTrade {
  quote: ConnectedWalletQuote;
  action: 'approve' | 'swap';
  transaction: {
    from: string;
    to: string;
    data: string;
    value: '0x0';
  };
}

export interface FaucetToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  claimAmount: string;
  faucetBalance: string;
  walletBalance: string;
}

export interface FaucetState {
  enabled: boolean;
  chainId: number;
  faucet: string | null;
  wallet: string | null;
  token0?: FaucetToken;
  token1?: FaucetToken;
  cooldownSeconds?: string;
  nextClaimAt?: string;
  serverTimestamp?: string;
  remainingClaims?: string;
  inventoryAvailable?: boolean;
  claimable?: boolean;
  reason: string | null;
}

export interface PreparedFaucetClaim {
  action: 'claim';
  state: FaucetState;
  transaction: {
    from: string;
    to: string;
    data: string;
    value: '0x0';
  };
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

export interface VaultRegistry {
  enabled: boolean;
  chainId: number;
  factory: string | null;
  router: string | null;
  vaults: string[];
  wallet: string | null;
  reason: string | null;
}

export interface VaultToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface VaultFeeSchedule {
  tightFeeBps: string;
  wideFeeBps: string;
  targetFeeBps: string;
  humanShareBps: string;
  tightVolume: string;
  wideVolume: string;
}

export interface VaultState {
  vault: string;
  factory: string;
  router: string;
  quota: string;
  manager: string;
  shareToken: VaultToken;
  token0: VaultToken;
  token1: VaultToken;
  reserves: { token0: string; token1: string };
  totalSupply: string;
  strategyActive: boolean;
  paused: boolean;
  orderHash: string;
  feeSchedules: {
    token0: VaultFeeSchedule;
    token1: VaultFeeSchedule;
  };
  position: {
    wallet: string | null;
    shares: string;
    ownershipPpb: string;
    claimToken0: string;
    claimToken1: string;
    token0Balance: string;
    token1Balance: string;
    token0Allowance: string;
    token1Allowance: string;
    accounting: {
      available: boolean;
      depositedToken0: string;
      depositedToken1: string;
      withdrawnToken0: string;
      withdrawnToken1: string;
      netContributedToken0: string;
      netContributedToken1: string;
      pnlToken0: string;
      pnlToken1: string;
      mintedShares: string;
      burnedShares: string;
      depositCount: number;
      withdrawalCount: number;
      error: string | null;
    };
  };
}

export type VaultTradeDirection = 'token0-to-token1' | 'token1-to-token0';

export interface VaultQuote {
  vault: string;
  router: string;
  orderHash: string;
  wallet: string;
  direction: VaultTradeDirection;
  tokenIn: VaultToken;
  tokenOut: VaultToken;
  amountIn: string;
  amountOut: string;
  balance: string;
  allowance: string;
  humanId: string;
  humanBacked: boolean;
  tight: boolean;
  tier: 'tight' | 'wide';
  feeBps: number;
  sufficientBalance: boolean;
  requiresApproval: boolean;
  feeSchedule: VaultFeeSchedule;
}

export interface PreparedVaultAction {
  action:
    | 'approve-token0'
    | 'approve-token1'
    | 'approve-trade-token'
    | 'deposit'
    | 'redeem'
    | 'swap'
    | 'create';
  transaction: {
    from: string;
    to: string;
    data: string;
    value: '0x0';
  };
  preview: Record<string, unknown>;
}
