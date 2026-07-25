import {
  concatHex,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  padHex,
  toHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { agentBookAbi, aquaAbi, erc20Abi, quotaAbi, routerAbi } from './abi.js';
import { client, deployments } from './chain.js';
import { RPC_URL } from './config.js';
import { parseDemoTradeDirection, type DemoTradeDirection } from './demo.js';

export type DemoTradeLane = 'human' | 'bot';
export { parseDemoTradeDirection };
export type { DemoTradeDirection };

export interface DemoTradeRoute {
  direction: DemoTradeDirection;
  zeroForOne: boolean;
  tokenIn: Address;
  tokenOut: Address;
  tokenInSymbol: 'tETH' | 'tUSD';
  tokenOutSymbol: 'tETH' | 'tUSD';
}

export interface HumanGateProgram {
  opcode: number;
  agentBook: Address;
  quota: Address;
  wideFeeBps: number;
  tightFeeBps: number;
}

export interface DemoTradeResult {
  lane: DemoTradeLane;
  direction: DemoTradeDirection;
  zeroForOne: boolean;
  tokenIn: Address;
  tokenOut: Address;
  tokenInSymbol: 'tETH' | 'tUSD';
  tokenOutSymbol: 'tETH' | 'tUSD';
  wallet: Address;
  transactionHash: Hex;
  approvalTransactionHash?: Hex;
  blockNumber: string;
  amountIn: string;
  amountOut: string;
  orderHash: Hex;
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

export type DemoTradeProgressStage =
  | 'wallet'
  | 'identity'
  | 'allowance'
  | 'simulation'
  | 'submission'
  | 'settlement'
  | 'receipt'
  | 'repricing';

export interface DemoTradeProgress {
  stage: DemoTradeProgressStage;
  status: 'active' | 'complete';
  title: string;
  detail: string;
  transactionHash?: Hex;
}

export type DemoTradeProgressReporter = (
  progress: DemoTradeProgress,
) => void | Promise<void>;

export interface RouterExecutionView {
  order: {
    maker: Address;
    traits: bigint;
    data: Hex;
  };
  orderHash: Hex;
  token0: Address;
  token1: Address;
  strategy: {
    maker: Address;
    token0: Address;
    token1: Address;
    wideFeeBps: bigint;
    tightFeeBps: bigint;
    salt: Hex;
  };
  program: HumanGateProgram;
}

export interface RouterQuote {
  direction: DemoTradeDirection;
  zeroForOne: boolean;
  tokenIn: Address;
  tokenOut: Address;
  tokenInSymbol: 'tETH' | 'tUSD';
  tokenOutSymbol: 'tETH' | 'tUSD';
  strategy: RouterExecutionView['strategy'];
  strategyHash: Hex;
  amountIn: bigint;
  amountOut: bigint;
  tight: boolean;
  feeBps: bigint;
  humanId: bigint;
  feeSchedule: OnChainFeeSchedule;
}

export interface OnChainFeeSchedule {
  tightFeeBps: bigint;
  wideFeeBps: bigint;
  targetFeeBps: bigint;
  humanShareBps: bigint;
  tightVolume: bigint;
  wideVolume: bigint;
}

export interface ConnectedWalletQuote {
  wallet: Address;
  chainId: number;
  direction: DemoTradeDirection;
  tokenIn: Address;
  tokenOut: Address;
  tokenInSymbol: 'tETH' | 'tUSD';
  tokenOutSymbol: 'tETH' | 'tUSD';
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
  router: Address;
  quota: Address;
  feeSchedule: {
    tightFeeBps: string;
    wideFeeBps: string;
    targetFeeBps: string;
    humanShareBps: string;
    tightVolume: string;
    wideVolume: string;
  };
}

export interface ConnectedWalletPreparation {
  quote: ConnectedWalletQuote;
  action: 'approve' | 'swap';
  transaction: {
    from: Address;
    to: Address;
    data: Hex;
    value: '0x0';
  };
}

const FEE_E9_PER_BPS = 100_000n;
const REQUIRED_OPCODE = 34;
const DEFAULT_MAX_TETH_IN = 10n ** 18n;
const DEFAULT_MAX_TUSD_IN = 4_000n * 10n ** 18n;
const ALLOWANCE_VISIBILITY_ATTEMPTS = 10;
const tradeInFlight = new Set<DemoTradeLane>();
const lastTradeAt = new Map<DemoTradeLane, number>();

export function parseWalletAddress(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error('wallet must be a valid EVM address');
  }
  return getAddress(value);
}

export function parseTransactionHash(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('transactionHash must be a 32-byte hex value');
  }
  return value as Hex;
}

function addressFromProgram(program: string, startByte: number): Address {
  return `0x${program.slice(2 + startByte * 2, 2 + (startByte + 20) * 2)}` as Address;
}

function uint32FromProgram(program: string, startByte: number): number {
  return Number(BigInt(`0x${program.slice(2 + startByte * 2, 2 + (startByte + 4) * 2)}`));
}

/**
 * Decode the first instruction in the shipped SwapVM program:
 * opcode(1) | argsLength(1) | AgentBook(20) | quota(20) | wideFeeE9(4) | tightFeeE9(4).
 */
export function parseHumanGateProgram(program: Hex): HumanGateProgram {
  if (!/^0x[0-9a-fA-F]+$/.test(program) || (program.length - 2) / 2 < 50) {
    throw new Error('SwapVM program is too short to contain _humanGate');
  }
  const opcode = Number(BigInt(`0x${program.slice(2, 4)}`));
  const argsLength = Number(BigInt(`0x${program.slice(4, 6)}`));
  if (opcode !== REQUIRED_OPCODE || argsLength !== 48) {
    throw new Error(`expected _humanGate opcode 34 with 48-byte args, got opcode=${opcode} args=${argsLength}`);
  }
  const wideFeeE9 = uint32FromProgram(program, 42);
  const tightFeeE9 = uint32FromProgram(program, 46);
  if (wideFeeE9 % Number(FEE_E9_PER_BPS) !== 0 || tightFeeE9 % Number(FEE_E9_PER_BPS) !== 0) {
    throw new Error('_humanGate fees are not whole basis points');
  }
  return {
    opcode,
    agentBook: addressFromProgram(program, 2),
    quota: addressFromProgram(program, 22),
    wideFeeBps: wideFeeE9 / Number(FEE_E9_PER_BPS),
    tightFeeBps: tightFeeE9 / Number(FEE_E9_PER_BPS),
  };
}

/**
 * SwapVM taker data starts with ten uint16 slice ends followed by uint16 flags.
 * 0x41 selects exact-in plus transferFrom/Aqua.push. An optional threshold
 * places a 32-byte minimum output in the first taker-data slice.
 */
export function buildTakerTraits(minAmountOut?: bigint): Hex {
  const flags = '0x0041' as Hex;
  if (minAmountOut === undefined) {
    return concatHex([padHex('0x', { size: 20 }), flags]);
  }
  return concatHex([
    `0x${'0020'.repeat(10)}` as Hex,
    flags,
    padHex(toHex(minAmountOut), { size: 32 }),
  ]);
}

export function selectDemoTradeRoute(
  view: Pick<RouterExecutionView, 'token0' | 'token1'>,
  direction: DemoTradeDirection,
): DemoTradeRoute {
  if (direction === 'tETH-to-tUSD') {
    return {
      direction,
      zeroForOne: true,
      tokenIn: view.token0,
      tokenOut: view.token1,
      tokenInSymbol: 'tETH',
      tokenOutSymbol: 'tUSD',
    };
  }
  return {
    direction,
    zeroForOne: false,
    tokenIn: view.token1,
    tokenOut: view.token0,
    tokenInSymbol: 'tUSD',
    tokenOutSymbol: 'tETH',
  };
}

export function directionFromZeroForOne(zeroForOne: boolean): DemoTradeDirection {
  return zeroForOne ? 'tETH-to-tUSD' : 'tUSD-to-tETH';
}

/**
 * Build the one execution view shared by terminal quotes, displayed inventory,
 * and submitted swaps. The app strategy is deliberately not consulted here:
 * SwapVM has its own Aqua namespace keyed by router + order hash.
 */
export function routerExecutionView(): RouterExecutionView {
  const program = parseHumanGateProgram(deployments.orderData);
  if (
    program.agentBook.toLowerCase() !== deployments.agentBook.toLowerCase() ||
    program.quota.toLowerCase() !== deployments.quota.toLowerCase()
  ) {
    throw new Error('shipped _humanGate program points at unexpected identity contracts');
  }
  return {
    order: {
      maker: deployments.maker,
      traits: BigInt(deployments.orderTraits),
      data: deployments.orderData,
    },
    orderHash: deployments.orderHash,
    token0: deployments.tETH,
    token1: deployments.tUSD,
    strategy: {
      maker: deployments.maker,
      token0: deployments.tETH,
      token1: deployments.tUSD,
      wideFeeBps: BigInt(program.wideFeeBps),
      tightFeeBps: BigInt(program.tightFeeBps),
      salt: padHex(toHex(BigInt(deployments.strategySalt)), { size: 32 }),
    },
    program,
  };
}

export function resolveHumanGateTier(
  program: HumanGateProgram,
  humanId: bigint,
  remaining: bigint | undefined,
  amountIn: bigint,
): { tight: boolean; feeBps: bigint } {
  if (humanId !== 0n && remaining === undefined) {
    throw new Error('quota remaining is required for a World ID-verified router quote');
  }
  const tight = humanId !== 0n && (remaining ?? 0n) >= amountIn;
  return {
    tight,
    feeBps: BigInt(tight ? program.tightFeeBps : program.wideFeeBps),
  };
}

export function applyFeeSchedule(
  program: HumanGateProgram,
  schedule: OnChainFeeSchedule,
): HumanGateProgram {
  if (schedule.tightFeeBps === 0n || schedule.wideFeeBps === 0n) return program;
  if (schedule.tightFeeBps > BigInt(Number.MAX_SAFE_INTEGER) || schedule.wideFeeBps > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('on-chain fee schedule exceeds the safe integer range');
  }
  return {
    ...program,
    tightFeeBps: Number(schedule.tightFeeBps),
    wideFeeBps: Number(schedule.wideFeeBps),
  };
}

async function readFeeSchedule(
  view: RouterExecutionView,
  token: Address = view.token0,
): Promise<OnChainFeeSchedule> {
  const [tightFeeBps, wideFeeBps, targetFeeBps, humanShareBps, tightVolume, wideVolume] =
    await client.readContract({
      address: view.program.quota,
      abi: quotaAbi,
      functionName: 'feeSchedule',
      args: [token],
    });
  return {
    tightFeeBps,
    wideFeeBps,
    targetFeeBps,
    humanShareBps,
    tightVolume,
    wideVolume,
  };
}

export async function quoteRouterFor(
  taker: Address,
  amountIn: bigint,
  view = routerExecutionView(),
  direction: DemoTradeDirection = 'tETH-to-tUSD',
): Promise<RouterQuote> {
  const route = selectDemoTradeRoute(view, direction);
  const [[quotedAmountIn, quotedAmountOut, orderHash], humanId, feeSchedule] = await Promise.all([
    client.readContract({
      address: deployments.router,
      abi: routerAbi,
      functionName: 'quote',
      args: [view.order, route.tokenIn, route.tokenOut, amountIn, buildTakerTraits()],
      account: taker,
    }),
    client.readContract({
      address: view.program.agentBook,
      abi: agentBookAbi,
      functionName: 'lookupHuman',
      args: [taker],
    }),
    readFeeSchedule(view, route.tokenIn),
  ]);
  if (
    quotedAmountIn !== amountIn ||
    quotedAmountOut <= 0n ||
    orderHash.toLowerCase() !== view.orderHash.toLowerCase()
  ) {
    throw new Error('SwapVM returned an invalid quote for the configured order');
  }
  const remaining =
    humanId === 0n
      ? undefined
      : await client.readContract({
          address: view.program.quota,
          abi: quotaAbi,
          functionName: 'remaining',
          args: [humanId, route.tokenIn],
        });
  const effectiveProgram = applyFeeSchedule(view.program, feeSchedule);
  const tier = resolveHumanGateTier(effectiveProgram, humanId, remaining, amountIn);
  return {
    ...route,
    strategy: {
      ...view.strategy,
      tightFeeBps: BigInt(effectiveProgram.tightFeeBps),
      wideFeeBps: BigInt(effectiveProgram.wideFeeBps),
    },
    strategyHash: orderHash,
    amountIn: quotedAmountIn,
    amountOut: quotedAmountOut,
    humanId,
    feeSchedule: {
      ...feeSchedule,
      tightFeeBps: BigInt(effectiveProgram.tightFeeBps),
      wideFeeBps: BigInt(effectiveProgram.wideFeeBps),
    },
    ...tier,
  };
}

export async function routerPoolState(view = routerExecutionView()) {
  const [computedOrderHash, feeController, policyState] = await Promise.all([
    client.readContract({
      address: deployments.router,
      abi: routerAbi,
      functionName: 'hash',
      args: [view.order],
    }),
    readFeeSchedule(view),
    client.readContract({
      address: view.program.quota,
      abi: quotaAbi,
      functionName: 'policyState',
      args: [view.token0],
    }),
  ]);
  if (computedOrderHash.toLowerCase() !== view.orderHash.toLowerCase()) {
    throw new Error(
      `configured SwapVM order hash ${view.orderHash} does not match router hash ${computedOrderHash}`,
    );
  }
  const [balance0, balance1] = await client.readContract({
    address: deployments.aqua,
    abi: aquaAbi,
    functionName: 'safeBalances',
    args: [
      view.order.maker,
      deployments.router,
      computedOrderHash,
      view.token0,
      view.token1,
    ],
  });
  const program = applyFeeSchedule(view.program, feeController);
  return {
    router: deployments.router,
    strategy: {
      ...view.strategy,
      tightFeeBps: BigInt(program.tightFeeBps),
      wideFeeBps: BigInt(program.wideFeeBps),
    },
    strategyHash: computedOrderHash,
    orderHash: computedOrderHash,
    program,
    feeController,
    riskPolicy: {
      updater: policyState[0],
      maxFeeStepBps: policyState[1],
      maxDataLagBlocks: policyState[2],
      indexedThroughBlock: policyState[3],
      decisionHash: policyState[4],
      desiredTightFeeBps: policyState[5],
      riskSpreadBps: policyState[6],
    },
    balance0,
    balance1,
  };
}

function privateKeyForLane(lane: DemoTradeLane): Hex {
  const environmentName = lane === 'human' ? 'HUMAN_AGENT_PRIVATE_KEY' : 'BOT_PRIVATE_KEY';
  const value = process.env[environmentName];
  if (!value) {
    throw new Error(`${environmentName} is not configured`);
  }
  const normalized = value.startsWith('0x') ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${environmentName} must be a 32-byte private key`);
  }
  return normalized as Hex;
}

function expectedAddress(lane: DemoTradeLane): Address {
  return lane === 'human' ? deployments.humanAgent : deployments.bot;
}

async function waitForRouterAllowance(
  token: Address,
  owner: Address,
  requiredAllowance: bigint,
): Promise<void> {
  for (let attempt = 0; attempt < ALLOWANCE_VISIBILITY_ATTEMPTS; attempt += 1) {
    try {
      const allowance = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner, deployments.router],
      });
      if (allowance >= requiredAllowance) return;
    } catch {
      // A load-balanced RPC can briefly fail or lag immediately after mining.
      // Retry within the same finite visibility budget.
    }
    if (attempt + 1 < ALLOWANCE_VISIBILITY_ATTEMPTS) {
      const delayMs = Math.min(100 * 2 ** attempt, 1_000);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw new Error('the RPC did not observe the mined token approval before the retry limit');
}

export interface RouterReceiptVenue {
  router: Address;
  orderHash: Hex;
  maker: Address;
}

export function decodeRouterReceipt(
  receipt: TransactionReceipt,
  wallet: Address,
  route: Pick<DemoTradeRoute, 'tokenIn' | 'tokenOut'>,
  venue: RouterReceiptVenue = {
    router: deployments.router,
    orderHash: deployments.orderHash,
    maker: deployments.maker,
  },
) {
  let gate: ReturnType<typeof decodeEventLog<typeof routerAbi>> | undefined;
  let swap: ReturnType<typeof decodeEventLog<typeof routerAbi>> | undefined;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== venue.router.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: routerAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === 'HumanGated') gate = decoded;
      if (decoded.eventName === 'Swapped') swap = decoded;
    } catch {
      // The router can emit unrelated inherited events; only these two prove execution.
    }
  }

  if (!gate || gate.eventName !== 'HumanGated') {
    throw new Error(`transaction ${receipt.transactionHash} did not emit HumanGated`);
  }
  if (!swap || swap.eventName !== 'Swapped') {
    throw new Error(`transaction ${receipt.transactionHash} did not emit the SwapVM Swapped event`);
  }
  if (
    gate.args.orderHash.toLowerCase() !== venue.orderHash.toLowerCase() ||
    gate.args.taker.toLowerCase() !== wallet.toLowerCase() ||
    swap.args.orderHash.toLowerCase() !== venue.orderHash.toLowerCase() ||
    swap.args.maker.toLowerCase() !== venue.maker.toLowerCase() ||
    swap.args.taker.toLowerCase() !== wallet.toLowerCase() ||
    swap.args.tokenIn.toLowerCase() !== route.tokenIn.toLowerCase() ||
    swap.args.tokenOut.toLowerCase() !== route.tokenOut.toLowerCase()
  ) {
    throw new Error('router receipt does not match the configured order, route, and execution wallet');
  }
  return { gate, swap };
}

export function marketTradesEnabled(): boolean {
  return process.env.MARKET_TRADES_ENABLED === '1';
}

let cachedRouterOpcode: number | undefined;

export async function routerOpcode(): Promise<number> {
  if (cachedRouterOpcode !== undefined) return cachedRouterOpcode;
  const opcode = await client.readContract({
    address: deployments.router,
    abi: routerAbi,
    functionName: 'humanGateOpcode',
  });
  if (opcode !== BigInt(REQUIRED_OPCODE)) {
    throw new Error(`unexpected _humanGate opcode: ${opcode}`);
  }
  cachedRouterOpcode = Number(opcode);
  return cachedRouterOpcode;
}

function executionLimit(direction: DemoTradeDirection): bigint {
  const configuredMax =
    direction === 'tETH-to-tUSD'
      ? process.env.MARKET_TRADE_MAX_TETH_IN ?? process.env.MARKET_TRADE_MAX_AMOUNT_IN
      : process.env.MARKET_TRADE_MAX_TUSD_IN;
  return BigInt(
    configuredMax ??
      (direction === 'tETH-to-tUSD' ? DEFAULT_MAX_TETH_IN : DEFAULT_MAX_TUSD_IN),
  );
}

function assertExecutableAmount(amountIn: bigint, direction: DemoTradeDirection): void {
  const maxAmountIn = executionLimit(direction);
  if (amountIn <= 0n || amountIn > maxAmountIn) {
    throw new Error(`amountIn must be between 1 and ${maxAmountIn}`);
  }
}

function connectedQuoteJson(
  wallet: Address,
  chainId: number,
  quote: RouterQuote,
  balance: bigint,
  allowance: bigint,
): ConnectedWalletQuote {
  return {
    wallet,
    chainId,
    direction: quote.direction,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    tokenInSymbol: quote.tokenInSymbol,
    tokenOutSymbol: quote.tokenOutSymbol,
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    balance: balance.toString(),
    allowance: allowance.toString(),
    humanId: quote.humanId.toString(),
    humanBacked: quote.humanId !== 0n,
    tight: quote.tight,
    tier: quote.tight ? 'tight' : 'wide',
    feeBps: Number(quote.feeBps),
    sufficientBalance: balance >= quote.amountIn,
    requiresApproval: allowance < quote.amountIn,
    router: deployments.router,
    quota: deployments.quota,
    feeSchedule: {
      tightFeeBps: quote.feeSchedule.tightFeeBps.toString(),
      wideFeeBps: quote.feeSchedule.wideFeeBps.toString(),
      targetFeeBps: quote.feeSchedule.targetFeeBps.toString(),
      humanShareBps: quote.feeSchedule.humanShareBps.toString(),
      tightVolume: quote.feeSchedule.tightVolume.toString(),
      wideVolume: quote.feeSchedule.wideVolume.toString(),
    },
  };
}

export async function quoteConnectedWallet(
  walletInput: unknown,
  amountIn: bigint,
  direction: DemoTradeDirection = 'tETH-to-tUSD',
): Promise<ConnectedWalletQuote> {
  const wallet = parseWalletAddress(walletInput);
  assertExecutableAmount(amountIn, direction);
  const view = routerExecutionView();
  const quote = await quoteRouterFor(wallet, amountIn, view, direction);
  const [chainId, balance, allowance] = await Promise.all([
    client.getChainId(),
    client.readContract({
      address: quote.tokenIn,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [wallet],
    }),
    client.readContract({
      address: quote.tokenIn,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [wallet, deployments.router],
    }),
  ]);
  return connectedQuoteJson(wallet, chainId, quote, balance, allowance);
}

export async function prepareConnectedWalletTrade(
  walletInput: unknown,
  amountIn: bigint,
  direction: DemoTradeDirection = 'tETH-to-tUSD',
): Promise<ConnectedWalletPreparation> {
  if (!marketTradesEnabled()) throw new Error('server-operated market trades are disabled');
  const wallet = parseWalletAddress(walletInput);
  const quote = await quoteConnectedWallet(wallet, amountIn, direction);
  if (!quote.sufficientBalance) {
    throw new Error(
      `insufficient ${quote.tokenInSymbol} balance: wallet has ${quote.balance}, requires ${quote.amountIn}`,
    );
  }
  if (quote.requiresApproval) {
    return {
      quote,
      action: 'approve',
      transaction: {
        from: wallet,
        to: quote.tokenIn,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [deployments.router, amountIn],
        }),
        value: '0x0',
      },
    };
  }

  const view = routerExecutionView();
  const slippageBps = BigInt(process.env.SLIPPAGE_BPS ?? '50');
  if (slippageBps < 0n || slippageBps >= 10_000n) {
    throw new Error('SLIPPAGE_BPS must be between 0 and 9999');
  }
  const minimumAmountOut =
    (BigInt(quote.amountOut) * (10_000n - slippageBps)) / 10_000n;
  const route = selectDemoTradeRoute(view, direction);
  const args = [
    view.order,
    route.tokenIn,
    route.tokenOut,
    amountIn,
    buildTakerTraits(minimumAmountOut),
  ] as const;
  await client.simulateContract({
    address: deployments.router,
    abi: routerAbi,
    functionName: 'swap',
    args,
    account: wallet,
  });

  return {
    quote,
    action: 'swap',
    transaction: {
      from: wallet,
      to: deployments.router,
      data: encodeFunctionData({
        abi: routerAbi,
        functionName: 'swap',
        args,
      }),
      value: '0x0',
    },
  };
}

export async function confirmConnectedWalletTrade(
  walletInput: unknown,
  transactionHashInput: unknown,
  direction: DemoTradeDirection = 'tETH-to-tUSD',
  approvalTransactionHashInput?: unknown,
): Promise<DemoTradeResult> {
  const wallet = parseWalletAddress(walletInput);
  const transactionHash = parseTransactionHash(transactionHashInput);
  const approvalTransactionHash =
    approvalTransactionHashInput === undefined
      ? undefined
      : parseTransactionHash(approvalTransactionHashInput);
  const receipt = await client.waitForTransactionReceipt({
    hash: transactionHash,
    confirmations: 1,
    pollingInterval: 500,
    timeout: 10_000,
  });
  if (receipt.status !== 'success') throw new Error(`SwapVM trade reverted: ${transactionHash}`);

  const view = routerExecutionView();
  const route = selectDemoTradeRoute(view, direction);
  const { gate, swap } = decodeRouterReceipt(receipt, wallet, route);
  const feeBps = Number(gate.args.feeE9 / FEE_E9_PER_BPS);
  const tight = gate.args.tight;
  const [opcode, feeSchedule, chainId] = await Promise.all([
    routerOpcode(),
    readFeeSchedule(view, route.tokenIn),
    client.getChainId(),
  ]);
  return {
    lane: gate.args.humanId !== 0n ? 'human' : 'bot',
    ...route,
    wallet,
    transactionHash,
    approvalTransactionHash,
    blockNumber: receipt.blockNumber.toString(),
    amountIn: swap.args.amountIn.toString(),
    amountOut: swap.args.amountOut.toString(),
    orderHash: gate.args.orderHash,
    opcode,
    event: 'HumanGated',
    humanId: gate.args.humanId.toString(),
    humanBacked: gate.args.humanId !== 0n,
    tight,
    tier: tight ? 'tight' : 'wide',
    feeBps,
    quotedFeeSchedule: {
      tightFeeBps: feeSchedule.tightFeeBps.toString(),
      wideFeeBps: feeSchedule.wideFeeBps.toString(),
      targetFeeBps: feeSchedule.targetFeeBps.toString(),
      humanShareBps: feeSchedule.humanShareBps.toString(),
      tightVolume: feeSchedule.tightVolume.toString(),
      wideVolume: feeSchedule.wideVolume.toString(),
    },
    explorerUrl: explorerTransactionUrl(chainId, transactionHash),
  };
}

export async function executeMarketTrade(
  lane: DemoTradeLane,
  amountIn: bigint,
  direction: DemoTradeDirection = 'tETH-to-tUSD',
  reportProgress?: DemoTradeProgressReporter,
): Promise<DemoTradeResult> {
  if (!marketTradesEnabled()) throw new Error('server-operated market trades are disabled');
  const view = routerExecutionView();
  const route = selectDemoTradeRoute(view, direction);
  assertExecutableAmount(amountIn, direction);
  if (tradeInFlight.has(lane)) throw new Error(`${lane} trade already in progress`);
  const previous = lastTradeAt.get(lane) ?? 0;
  if (Date.now() - previous < 4_000) throw new Error(`wait before submitting another ${lane} trade`);

  tradeInFlight.add(lane);
  try {
    await reportProgress?.({
      stage: 'wallet',
      status: 'active',
      title: 'Authenticate execution signer',
      detail: `Loading the configured ${lane} execution wallet`,
    });
    const key = privateKeyForLane(lane);
    const account = privateKeyToAccount(key);
    const expected = expectedAddress(lane);
    if (account.address.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`${lane} signing key resolves to ${account.address}, expected ${expected}`);
    }
    await reportProgress?.({
      stage: 'wallet',
      status: 'complete',
      title: 'Execution signer matched',
      detail: `${account.address.slice(0, 8)}…${account.address.slice(-6)} matches the configured ${lane} wallet`,
    });

    const opcode = await routerOpcode();
    const transport = http(RPC_URL);
    const walletClient = createWalletClient({ account, transport });
    await reportProgress?.({
      stage: 'identity',
      status: 'active',
      title: 'Resolve identity and quote',
      detail: `Calling SwapVM opcode ${opcode}, canonical AgentBook, and HumanQuota on World Chain`,
    });
    const quote = await quoteRouterFor(account.address, amountIn, view, direction);
    await reportProgress?.({
      stage: 'identity',
      status: 'complete',
      title: quote.humanId === 0n ? 'HFT / arbitrage flow resolved' : 'Human backing resolved',
      detail:
        quote.humanId === 0n
          ? `AgentBook returned humanId 0 · WIDE lane · ${quote.feeBps} bps`
          : `AgentBook returned humanId ${quote.humanId.toString().slice(0, 12)}… · TIGHT lane · ${quote.feeBps} bps`,
    });

    await reportProgress?.({
      stage: 'allowance',
      status: 'active',
      title: 'Check token allowance',
      detail: `Reading ${route.tokenInSymbol} allowance for the active SwapVM router`,
    });
    let approvalTransactionHash: Hex | undefined;
    const allowance = await client.readContract({
      address: route.tokenIn,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, deployments.router],
    });
    if (allowance < amountIn) {
      approvalTransactionHash = await walletClient.writeContract({
        address: route.tokenIn,
        abi: erc20Abi,
        functionName: 'approve',
        args: [deployments.router, amountIn],
        chain: null,
      });
      const approval = await client.waitForTransactionReceipt({ hash: approvalTransactionHash });
      if (approval.status !== 'success') {
        throw new Error(`token approval reverted: ${approvalTransactionHash}`);
      }
      await waitForRouterAllowance(route.tokenIn, account.address, amountIn);
    }
    await reportProgress?.({
      stage: 'allowance',
      status: 'complete',
      title: approvalTransactionHash ? 'Token approval mined' : 'Token allowance ready',
      detail: approvalTransactionHash
        ? `${route.tokenInSymbol} approval confirmed before execution`
        : `Existing ${route.tokenInSymbol} allowance covers this trade`,
      transactionHash: approvalTransactionHash,
    });

    const slippageBps = BigInt(process.env.SLIPPAGE_BPS ?? '50');
    if (slippageBps < 0n || slippageBps >= 10_000n) {
      throw new Error('SLIPPAGE_BPS must be between 0 and 9999');
    }
    const minimumAmountOut = (quote.amountOut * (10_000n - slippageBps)) / 10_000n;
    await reportProgress?.({
      stage: 'simulation',
      status: 'active',
      title: 'Simulate SwapVM execution',
      detail: `Checking opcode ${opcode}, slippage floor, and Aqua inventory without changing state`,
    });
    const simulation = await client.simulateContract({
      address: deployments.router,
      abi: routerAbi,
      functionName: 'swap',
      args: [
        view.order,
        route.tokenIn,
        route.tokenOut,
        amountIn,
        buildTakerTraits(minimumAmountOut),
      ],
      account,
    });
    await reportProgress?.({
      stage: 'simulation',
      status: 'complete',
      title: 'Simulation passed',
      detail: `Quote is executable through opcode ${opcode} against maker-owned Aqua inventory`,
    });
    await reportProgress?.({
      stage: 'submission',
      status: 'active',
      title: 'Submit on-chain trade',
      detail: 'Signing and broadcasting the simulated SwapVM request',
    });
    const transactionHash = await walletClient.writeContract({
      ...simulation.request,
      chain: null,
    });
    await reportProgress?.({
      stage: 'submission',
      status: 'complete',
      title: 'Transaction broadcast',
      detail: `${transactionHash.slice(0, 12)}… is pending on the execution chain`,
      transactionHash,
    });
    await reportProgress?.({
      stage: 'settlement',
      status: 'active',
      title: 'Await Aqua settlement',
      detail: 'Waiting for the maker inventory transfer and SwapVM receipt',
      transactionHash,
    });
    const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== 'success') throw new Error(`SwapVM trade reverted: ${transactionHash}`);
    await reportProgress?.({
      stage: 'settlement',
      status: 'complete',
      title: 'Aqua settlement mined',
      detail: `Execution block ${receipt.blockNumber} confirmed the inventory movement`,
      transactionHash,
    });

    const { gate, swap } = decodeRouterReceipt(receipt, account.address, route);
    const feeBps = Number(gate.args.feeE9 / FEE_E9_PER_BPS);
    const tight = gate.args.tight;
    await reportProgress?.({
      stage: 'receipt',
      status: 'complete',
      title: 'Receipt independently verified',
      detail: `HumanGated + Swapped events prove ${tight ? 'TIGHT' : 'WIDE'} execution at ${feeBps} bps`,
      transactionHash,
    });
    await reportProgress?.({
      stage: 'repricing',
      status: 'active',
      title: 'Reprice the next market',
      detail: 'Reading the post-trade HumanQuota volume controller',
      transactionHash,
    });
    try {
      const nextSchedule = await readFeeSchedule(view);
      await reportProgress?.({
        stage: 'repricing',
        status: 'complete',
        title: 'Next fee pair is live',
        detail: `${nextSchedule.tightFeeBps}/${nextSchedule.wideFeeBps} bps human/bot · ${nextSchedule.targetFeeBps} bps LP target`,
        transactionHash,
      });
    } catch {
      await reportProgress?.({
        stage: 'repricing',
        status: 'complete',
        title: 'Volume update mined',
        detail: 'The dashboard will read the new fee pair on its next refresh',
        transactionHash,
      });
    }
    lastTradeAt.set(lane, Date.now());
    return {
      lane,
      ...route,
      wallet: account.address,
      transactionHash,
      approvalTransactionHash,
      blockNumber: receipt.blockNumber.toString(),
      amountIn: swap.args.amountIn.toString(),
      amountOut: swap.args.amountOut.toString(),
      orderHash: gate.args.orderHash,
      opcode,
      event: 'HumanGated',
      humanId: gate.args.humanId.toString(),
      humanBacked: gate.args.humanId !== 0n,
      tight,
      tier: tight ? 'tight' : 'wide',
      feeBps,
      quotedFeeSchedule: {
        tightFeeBps: quote.feeSchedule.tightFeeBps.toString(),
        wideFeeBps: quote.feeSchedule.wideFeeBps.toString(),
        targetFeeBps: quote.feeSchedule.targetFeeBps.toString(),
        humanShareBps: quote.feeSchedule.humanShareBps.toString(),
        tightVolume: quote.feeSchedule.tightVolume.toString(),
        wideVolume: quote.feeSchedule.wideVolume.toString(),
      },
      explorerUrl: explorerTransactionUrl(await client.getChainId(), transactionHash),
    };
  } finally {
    tradeInFlight.delete(lane);
  }
}

export function explorerTransactionUrl(chainId: number, transactionHash: Hex): string {
  if (chainId === 480) return `https://worldscan.org/tx/${transactionHash}`;
  return `https://blockscan.com/tx/${transactionHash}`;
}
