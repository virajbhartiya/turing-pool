import {
  concatHex,
  createWalletClient,
  decodeEventLog,
  http,
  maxUint256,
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

export type DemoTradeLane = 'human' | 'bot';

export interface HumanGateProgram {
  opcode: number;
  agentBook: Address;
  quota: Address;
  wideFeeBps: number;
  tightFeeBps: number;
}

export interface DemoTradeResult {
  lane: DemoTradeLane;
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
  explorerUrl: string;
}

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
  strategy: RouterExecutionView['strategy'];
  strategyHash: Hex;
  amountIn: bigint;
  amountOut: bigint;
  tight: boolean;
  feeBps: bigint;
  humanId: bigint;
}

export interface OnChainFeeSchedule {
  tightFeeBps: bigint;
  wideFeeBps: bigint;
  targetFeeBps: bigint;
  humanShareBps: bigint;
  tightVolume: bigint;
  wideVolume: bigint;
}

const FEE_E9_PER_BPS = 100_000n;
const REQUIRED_OPCODE = 34;
const DEFAULT_MAX_AMOUNT_IN = 10n ** 18n;
const tradeInFlight = new Set<DemoTradeLane>();
const lastTradeAt = new Map<DemoTradeLane, number>();

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
    throw new Error('quota remaining is required for a human-backed router quote');
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
  zeroForOne = true,
): Promise<RouterQuote> {
  const tokenIn = zeroForOne ? view.token0 : view.token1;
  const tokenOut = zeroForOne ? view.token1 : view.token0;
  const [[quotedAmountIn, quotedAmountOut, orderHash], humanId, feeSchedule] = await Promise.all([
    client.readContract({
      address: deployments.router,
      abi: routerAbi,
      functionName: 'quote',
      args: [view.order, tokenIn, tokenOut, amountIn, buildTakerTraits()],
      account: taker,
    }),
    client.readContract({
      address: view.program.agentBook,
      abi: agentBookAbi,
      functionName: 'lookupHuman',
      args: [taker],
    }),
    readFeeSchedule(view, tokenIn),
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
          args: [humanId, tokenIn],
        });
  const effectiveProgram = applyFeeSchedule(view.program, feeSchedule);
  const tier = resolveHumanGateTier(effectiveProgram, humanId, remaining, amountIn);
  return {
    strategy: {
      ...view.strategy,
      tightFeeBps: BigInt(effectiveProgram.tightFeeBps),
      wideFeeBps: BigInt(effectiveProgram.wideFeeBps),
    },
    strategyHash: orderHash,
    amountIn: quotedAmountIn,
    amountOut: quotedAmountOut,
    humanId,
    ...tier,
  };
}

export async function routerPoolState(view = routerExecutionView()) {
  const [computedOrderHash, feeController] = await Promise.all([
    client.readContract({
      address: deployments.router,
      abi: routerAbi,
      functionName: 'hash',
      args: [view.order],
    }),
    readFeeSchedule(view),
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
    strategy: {
      ...view.strategy,
      tightFeeBps: BigInt(program.tightFeeBps),
      wideFeeBps: BigInt(program.wideFeeBps),
    },
    strategyHash: computedOrderHash,
    orderHash: computedOrderHash,
    program,
    feeController,
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
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${environmentName} must be a 0x-prefixed 32-byte private key`);
  }
  return value as Hex;
}

function expectedAddress(lane: DemoTradeLane): Address {
  return lane === 'human' ? deployments.humanAgent : deployments.bot;
}

function decodeRouterReceipt(receipt: TransactionReceipt, wallet: Address) {
  let gate: ReturnType<typeof decodeEventLog<typeof routerAbi>> | undefined;
  let swap: ReturnType<typeof decodeEventLog<typeof routerAbi>> | undefined;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== deployments.router.toLowerCase()) continue;
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
    gate.args.orderHash.toLowerCase() !== deployments.orderHash.toLowerCase() ||
    gate.args.taker.toLowerCase() !== wallet.toLowerCase() ||
    swap.args.orderHash.toLowerCase() !== deployments.orderHash.toLowerCase() ||
    swap.args.taker.toLowerCase() !== wallet.toLowerCase()
  ) {
    throw new Error('router receipt does not match the configured order and demo wallet');
  }
  return { gate, swap };
}

export function demoTradesEnabled(): boolean {
  return process.env.DEMO_TRADES_ENABLED === '1';
}

export async function routerOpcode(): Promise<number> {
  const opcode = await client.readContract({
    address: deployments.router,
    abi: routerAbi,
    functionName: 'humanGateOpcode',
  });
  if (opcode !== BigInt(REQUIRED_OPCODE)) {
    throw new Error(`unexpected _humanGate opcode: ${opcode}`);
  }
  return Number(opcode);
}

export async function executeDemoTrade(
  lane: DemoTradeLane,
  amountIn: bigint,
): Promise<DemoTradeResult> {
  if (!demoTradesEnabled()) throw new Error('interactive demo trades are disabled');
  const maxAmountIn = BigInt(process.env.DEMO_TRADE_MAX_AMOUNT_IN ?? DEFAULT_MAX_AMOUNT_IN);
  if (amountIn <= 0n || amountIn > maxAmountIn) {
    throw new Error(`amountIn must be between 1 and ${maxAmountIn}`);
  }
  if (tradeInFlight.has(lane)) throw new Error(`${lane} trade already in progress`);
  const previous = lastTradeAt.get(lane) ?? 0;
  if (Date.now() - previous < 4_000) throw new Error(`wait before submitting another ${lane} trade`);

  tradeInFlight.add(lane);
  try {
    const key = privateKeyForLane(lane);
    const account = privateKeyToAccount(key);
    const expected = expectedAddress(lane);
    if (account.address.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`${lane} signing key resolves to ${account.address}, expected ${expected}`);
    }

    const view = routerExecutionView();
    const opcode = await routerOpcode();
    const transport = http(RPC_URL);
    const walletClient = createWalletClient({ account, transport });
    const quote = await quoteRouterFor(account.address, amountIn, view);

    let approvalTransactionHash: Hex | undefined;
    const allowance = await client.readContract({
      address: deployments.tETH,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, deployments.router],
    });
    if (allowance < amountIn) {
      approvalTransactionHash = await walletClient.writeContract({
        address: deployments.tETH,
        abi: erc20Abi,
        functionName: 'approve',
        args: [deployments.router, maxUint256],
        chain: null,
      });
      const approval = await client.waitForTransactionReceipt({ hash: approvalTransactionHash });
      if (approval.status !== 'success') {
        throw new Error(`token approval reverted: ${approvalTransactionHash}`);
      }
    }

    const slippageBps = BigInt(process.env.SLIPPAGE_BPS ?? '50');
    if (slippageBps < 0n || slippageBps >= 10_000n) {
      throw new Error('SLIPPAGE_BPS must be between 0 and 9999');
    }
    const minimumAmountOut = (quote.amountOut * (10_000n - slippageBps)) / 10_000n;
    const simulation = await client.simulateContract({
      address: deployments.router,
      abi: routerAbi,
      functionName: 'swap',
      args: [
        view.order,
        view.token0,
        view.token1,
        amountIn,
        buildTakerTraits(minimumAmountOut),
      ],
      account,
    });
    const transactionHash = await walletClient.writeContract({
      ...simulation.request,
      chain: null,
    });
    const receipt = await client.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== 'success') throw new Error(`SwapVM trade reverted: ${transactionHash}`);

    const { gate, swap } = decodeRouterReceipt(receipt, account.address);
    const feeBps = Number(gate.args.feeE9 / FEE_E9_PER_BPS);
    const tight = gate.args.tight;
    lastTradeAt.set(lane, Date.now());
    return {
      lane,
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
      explorerUrl: explorerTransactionUrl(await client.getChainId(), transactionHash),
    };
  } finally {
    tradeInFlight.delete(lane);
  }
}

function explorerTransactionUrl(chainId: number, transactionHash: Hex): string {
  if (chainId === 480) return `https://worldscan.org/tx/${transactionHash}`;
  if (chainId === 8453) return `https://basescan.org/tx/${transactionHash}`;
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${transactionHash}`;
  return `https://blockscan.com/tx/${transactionHash}`;
}
