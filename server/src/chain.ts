import { createPublicClient, decodeAbiParameters, http } from 'viem';
import { appAbi, aquaAbi, agentBookAbi, quotaAbi, strategyAbiParams } from './abi.js';
import { loadDeployments, RPC_URL, type Deployments } from './config.js';

export interface Strategy {
  maker: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  wideFeeBps: bigint;
  tightFeeBps: bigint;
  salt: `0x${string}`;
}

export const deployments: Deployments = loadDeployments();

// Let viem preserve its concrete transport/chain generics. Widening this to
// PublicClient breaks strict type-checking across viem releases.
export const client = createPublicClient({ transport: http(RPC_URL) });

// Scan logs only from the demo deployment onward - a Base mainnet fork's upstream
// RPC rejects wide eth_getLogs ranges, and everything we index is post-deploy.
const FROM_BLOCK = BigInt(deployments.deployBlock ?? 0);

interface StrategyLifecycle {
  strategy: Strategy;
  strategyHash: `0x${string}`;
  blockNumber: bigint;
  transactionHash: `0x${string}` | null;
  active: boolean;
}

interface StrategySnapshot {
  latestBlock: bigint;
  strategies: StrategyLifecycle[];
}

let strategyCache: StrategySnapshot | undefined;
let strategyLoad: Promise<StrategySnapshot> | undefined;

function decodeStrategy(encoded: `0x${string}`): Strategy {
  const [decoded] = decodeAbiParameters(strategyAbiParams, encoded);
  return {
    maker: decoded.maker,
    token0: decoded.token0,
    token1: decoded.token1,
    wideFeeBps: decoded.wideFeeBps,
    tightFeeBps: decoded.tightFeeBps,
    salt: decoded.salt,
  };
}

/// One event scan per block is shared by every quote/state request. This keeps
/// the active strategy honest after dock+ship without re-scanning twice for
/// each of the dashboard's concurrent requests.
async function loadStrategySnapshot(): Promise<StrategySnapshot> {
  if (strategyLoad) return strategyLoad;
  strategyLoad = (async () => {
    // viem caches blockNumber for ~4s by default, which is long enough to hide
    // the next scripted demo transaction. The event payloads are still cached
    // per block below; only this inexpensive head check must be fresh.
    const latestBlock = await client.getBlockNumber({ cacheTime: 0 });
    if (strategyCache?.latestBlock === latestBlock) return strategyCache;

    const [shipped, docked] = await Promise.all([
      client.getLogs({
        address: deployments.aqua,
        event: aquaAbi.find((e) => e.type === 'event' && e.name === 'Shipped') as any,
        fromBlock: FROM_BLOCK,
        toBlock: latestBlock,
      }),
      client.getLogs({
        address: deployments.aqua,
        event: aquaAbi.find((e) => e.type === 'event' && e.name === 'Docked') as any,
        fromBlock: FROM_BLOCK,
        toBlock: latestBlock,
      }),
    ]);

    const dockedHashes = new Set(
      docked
        .filter((l: any) => (l.args.app as string).toLowerCase() === deployments.app.toLowerCase())
        .map((l: any) => l.args.strategyHash as string),
    );

    const strategies = (shipped as any[])
      .filter((log) => (log.args.app as string).toLowerCase() === deployments.app.toLowerCase())
      .map((log) => {
        const strategyHash = log.args.strategyHash as `0x${string}`;
        return {
          strategy: decodeStrategy(log.args.strategy as `0x${string}`),
          strategyHash,
          blockNumber: log.blockNumber as bigint,
          transactionHash: (log.transactionHash ?? null) as `0x${string}` | null,
          active: !dockedHashes.has(strategyHash),
        };
      });

    strategyCache = { latestBlock, strategies };
    return strategyCache;
  })().finally(() => {
    strategyLoad = undefined;
  });
  return strategyLoad;
}

/// The maker can dock + re-ship (that's how the strategist reprices), so the
/// currently active strategy is discovered from Aqua's own Shipped/Docked events.
export async function getActiveStrategy(): Promise<{ strategy: Strategy; strategyHash: `0x${string}` }> {
  const snapshot = await loadStrategySnapshot();
  const active = [...snapshot.strategies].reverse().find((strategy) => strategy.active);

  if (!active) throw new Error('No active TuringPool strategy shipped on Aqua');

  return { strategy: active.strategy, strategyHash: active.strategyHash };
}

export async function strategyHistory() {
  const snapshot = await loadStrategySnapshot();
  return snapshot.strategies.map((entry, index, all) => {
    const previous = all[index - 1];
    return {
      blockNumber: entry.blockNumber.toString(),
      transactionHash: entry.transactionHash,
      strategyHash: entry.strategyHash,
      active: entry.active,
      kind: index === 0 ? 'initial-ship' : 'repriced',
      from:
        previous === undefined
          ? null
          : {
              tightFeeBps: previous.strategy.tightFeeBps.toString(),
              wideFeeBps: previous.strategy.wideFeeBps.toString(),
            },
      to: {
        tightFeeBps: entry.strategy.tightFeeBps.toString(),
        wideFeeBps: entry.strategy.wideFeeBps.toString(),
      },
    };
  });
}

export async function quoteFor(taker: `0x${string}`, amountIn: bigint, zeroForOne: boolean) {
  const { strategy, strategyHash } = await getActiveStrategy();
  const [amountOut, tight, feeBps, humanId] = (await client.readContract({
    address: deployments.app,
    abi: appAbi,
    functionName: 'quoteExactIn',
    args: [strategy, zeroForOne, amountIn, taker],
  })) as readonly [bigint, boolean, bigint, bigint];
  return { strategy, strategyHash, amountOut, tight, feeBps, humanId };
}

export async function lookupHuman(agent: `0x${string}`): Promise<bigint> {
  return (await client.readContract({
    address: deployments.agentBook,
    abi: agentBookAbi,
    functionName: 'lookupHuman',
    args: [agent],
  })) as bigint;
}

export async function quotaRemaining(humanId: bigint, token: `0x${string}`): Promise<bigint> {
  return (await client.readContract({
    address: deployments.quota,
    abi: quotaAbi,
    functionName: 'remaining',
    args: [humanId, token],
  })) as bigint;
}

export async function dailyCap(token: `0x${string}`): Promise<bigint> {
  return (await client.readContract({
    address: deployments.quota,
    abi: quotaAbi,
    functionName: 'dailyCap',
    args: [token],
  })) as bigint;
}

export async function poolState() {
  const { strategy, strategyHash } = await getActiveStrategy();
  const [bal0, bal1] = (await client.readContract({
    address: deployments.aqua,
    abi: aquaAbi,
    functionName: 'safeBalances',
    args: [strategy.maker, deployments.app, strategyHash, strategy.token0, strategy.token1],
  })) as readonly [bigint, bigint];
  return { strategy, strategyHash, balance0: bal0, balance1: bal1 };
}

interface SwapSnapshot {
  latestBlock: bigint;
  swaps: ReturnType<typeof swapFromLog>[];
}

function swapFromLog(l: any) {
  return {
    blockNumber: String(l.blockNumber),
    transactionHash: l.transactionHash as `0x${string}` | null,
    taker: l.args.taker,
    humanId: String(l.args.humanId),
    tight: l.args.tight,
    tokenIn: l.args.tokenIn,
    tokenOut: l.args.tokenOut,
    amountIn: String(l.args.amountIn),
    amountOut: String(l.args.amountOut),
    feeBps: String(l.args.feeBps),
  };
}

let swapCache: SwapSnapshot | undefined;
let swapLoad: Promise<SwapSnapshot> | undefined;

export async function recentSwaps(limit = 50) {
  if (!swapLoad) {
    swapLoad = (async () => {
      const latestBlock = await client.getBlockNumber({ cacheTime: 0 });
      if (swapCache?.latestBlock === latestBlock) return swapCache;
      const logs = await client.getLogs({
        address: deployments.app,
        event: appAbi.find((e) => e.type === 'event' && e.name === 'Swapped') as any,
        fromBlock: FROM_BLOCK,
        toBlock: latestBlock,
      });
      swapCache = {
        latestBlock,
        swaps: logs.map(swapFromLog),
      };
      return swapCache;
    })().finally(() => {
      swapLoad = undefined;
    });
  }
  const snapshot = await swapLoad;
  return snapshot.swaps.slice(-limit);
}
