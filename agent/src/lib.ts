import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  publicActions,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createAgentkitClient, type AgentkitClient } from '@worldcoin/agentkit';

const here = dirname(fileURLToPath(import.meta.url));

export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
export const API_URL = process.env.API_URL ?? 'http://localhost:4021';
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);

// Anvil's well-known dev keys (match DeployDemo.s.sol assignments).
export const KEYS = {
  maker: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  bot: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  humanAgent: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  sybilAgent: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
} as const;

export function loadDeployments() {
  const path =
    process.env.DEPLOYMENTS_PATH ?? resolve(here, '../../contracts/deployments/demo.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function makeWallet(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({ account, transport: http(RPC_URL) }).extend(publicActions);
}

export const publicClient = createPublicClient({ transport: http(RPC_URL) });

/// The official AgentKit client: wraps fetch, reacts to 402 + agentkit extension
/// by signing a CAIP-122/SIWE message with the agent's wallet and retrying.
export function makeAgentkitFetch(privateKey: Hex): AgentkitClient {
  const account = privateKeyToAccount(privateKey);
  return createAgentkitClient({
    signer: {
      address: account.address,
      chainId: `eip155:${CHAIN_ID}`,
      type: 'eip191',
      signMessage: (message: string) => account.signMessage({ message }),
    },
    onEvent: (event) => {
      if (event.type === 'agentkit_detected') console.log('  [agentkit] 402 challenge detected, signing SIWE proof...');
      if (event.type === 'agentkit_signed') console.log(`  [agentkit] signed with ${event.signatureType} on ${event.chainId}`);
      if (event.type === 'agentkit_retry_completed') console.log(`  [agentkit] retried with proof -> HTTP ${event.status}`);
      if (event.type === 'agentkit_skipped') console.log(`  [agentkit] skipped: ${event.reason}`);
    },
  });
}

export const erc20Abi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export const appAbi = [
  {
    type: 'function',
    name: 'swapExactIn',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'strategy',
        type: 'tuple',
        components: [
          { name: 'maker', type: 'address' },
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'wideFeeBps', type: 'uint256' },
          { name: 'tightFeeBps', type: 'uint256' },
          { name: 'salt', type: 'bytes32' },
        ],
      },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

export interface QuoteResponse {
  identity: { verified: boolean; humanBacked?: boolean; humanId?: string; address?: string };
  tier: 'tight' | 'wide';
  feeBps: string;
  amountOut: string;
  wideAmountOut: string;
  improvementBps: number;
  quotaRemainingTokenIn: string;
  execute: {
    to: `0x${string}`;
    strategy: {
      maker: `0x${string}`;
      token0: `0x${string}`;
      token1: `0x${string}`;
      wideFeeBps: string;
      tightFeeBps: string;
      salt: `0x${string}`;
    };
  };
}

export async function executeSwap(
  wallet: ReturnType<typeof makeWallet>,
  quote: QuoteResponse,
  tokenIn: `0x${string}`,
  amountIn: bigint,
): Promise<{ amountOut: bigint; txHash: `0x${string}` }> {
  const s = quote.execute.strategy;
  const strategy = {
    maker: s.maker,
    token0: s.token0,
    token1: s.token1,
    wideFeeBps: BigInt(s.wideFeeBps),
    tightFeeBps: BigInt(s.tightFeeBps),
    salt: s.salt,
  };

  const approvalHash = await wallet.writeContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: 'approve',
    args: [quote.execute.to, amountIn],
    chain: null,
  });
  await wallet.waitForTransactionReceipt({ hash: approvalHash });

  const slippageBps = BigInt(process.env.SLIPPAGE_BPS ?? '50');
  if (slippageBps < 0n || slippageBps >= 10_000n) {
    throw new Error(`SLIPPAGE_BPS must be between 0 and 9999, got ${slippageBps}`);
  }
  const amountOutMin = (BigInt(quote.amountOut) * (10_000n - slippageBps)) / 10_000n;

  const { result } = await wallet.simulateContract({
    address: quote.execute.to,
    abi: appAbi,
    functionName: 'swapExactIn',
    args: [strategy, true, amountIn, amountOutMin, wallet.account.address],
    account: wallet.account,
  });
  const txHash = await wallet.writeContract({
    address: quote.execute.to,
    abi: appAbi,
    functionName: 'swapExactIn',
    args: [strategy, true, amountIn, amountOutMin, wallet.account.address],
    chain: null,
  });
  await wallet.waitForTransactionReceipt({ hash: txHash });
  return { amountOut: result as bigint, txHash };
}

export function fmt(amount: string | bigint, decimals = 18, digits = 2): string {
  return Number(formatUnits(BigInt(amount), decimals)).toLocaleString('en-US', {
    maximumFractionDigits: digits,
  });
}
