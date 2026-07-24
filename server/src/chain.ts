import { createPublicClient, decodeAbiParameters, http, type PublicClient } from 'viem';
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

export const client: PublicClient = createPublicClient({ transport: http(RPC_URL) });

/// The maker can dock + re-ship (that's how the strategist reprices), so the
/// currently active strategy is discovered from Aqua's own Shipped/Docked events.
export async function getActiveStrategy(): Promise<{ strategy: Strategy; strategyHash: `0x${string}` }> {
  const [shipped, docked] = await Promise.all([
    client.getLogs({
      address: deployments.aqua,
      event: aquaAbi.find((e) => e.type === 'event' && e.name === 'Shipped') as any,
      fromBlock: 0n,
    }),
    client.getLogs({
      address: deployments.aqua,
      event: aquaAbi.find((e) => e.type === 'event' && e.name === 'Docked') as any,
      fromBlock: 0n,
    }),
  ]);

  const dockedHashes = new Set(
    docked
      .filter((l: any) => (l.args.app as string).toLowerCase() === deployments.app.toLowerCase())
      .map((l: any) => l.args.strategyHash as string),
  );

  const active = [...shipped]
    .reverse()
    .find(
      (l: any) =>
        (l.args.app as string).toLowerCase() === deployments.app.toLowerCase() &&
        !dockedHashes.has(l.args.strategyHash as string),
    ) as any;

  if (!active) throw new Error('No active TuringPool strategy shipped on Aqua');

  const [decoded] = decodeAbiParameters(strategyAbiParams, active.args.strategy as `0x${string}`);
  const strategy: Strategy = {
    maker: decoded.maker,
    token0: decoded.token0,
    token1: decoded.token1,
    wideFeeBps: decoded.wideFeeBps,
    tightFeeBps: decoded.tightFeeBps,
    salt: decoded.salt,
  };
  return { strategy, strategyHash: active.args.strategyHash };
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

export async function recentSwaps(limit = 50) {
  const logs = await client.getLogs({
    address: deployments.app,
    event: appAbi.find((e) => e.type === 'event' && e.name === 'Swapped') as any,
    fromBlock: 0n,
  });
  const swaps = await Promise.all(
    logs.slice(-limit).map(async (l: any) => {
      const block = await client.getBlock({ blockNumber: l.blockNumber });
      return {
        blockNumber: String(l.blockNumber),
        timestamp: String(block.timestamp),
        taker: l.args.taker,
        humanId: String(l.args.humanId),
        tight: l.args.tight,
        tokenIn: l.args.tokenIn,
        tokenOut: l.args.tokenOut,
        amountIn: String(l.args.amountIn),
        amountOut: String(l.args.amountOut),
        feeBps: String(l.args.feeBps),
      };
    }),
  );
  return swaps;
}
