import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  padHex,
  toHex,
  publicActions,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createAgentkitClient, type AgentkitClient } from '@worldcoin/agentkit';

const here = dirname(fileURLToPath(import.meta.url));

export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
export const API_URL = process.env.API_URL ?? 'http://localhost:4021';
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
export const AGENTKIT_SIGNER_CHAIN_ID = Number(
  process.env.AGENTKIT_SIGNER_CHAIN_ID ?? CHAIN_ID,
);

if (!Number.isSafeInteger(AGENTKIT_SIGNER_CHAIN_ID) || AGENTKIT_SIGNER_CHAIN_ID <= 0) {
  throw new Error('AGENTKIT_SIGNER_CHAIN_ID must be a positive EVM chain ID');
}

type AgentRole = 'maker' | 'bot' | 'humanAgent' | 'sybilAgent';
type AgentKeyEnvironment = Partial<
  Record<
    | 'MAKER_PRIVATE_KEY'
    | 'BOT_PRIVATE_KEY'
    | 'HUMAN_AGENT_PRIVATE_KEY'
    | 'SYBIL_AGENT_PRIVATE_KEY',
    string
  >
>;

// Anvil's well-known dev keys (match DeployDemo.s.sol assignments). Public
// deployments must override these so they do not use globally shared accounts.
const ANVIL_KEYS: Record<AgentRole, Hex> = {
  maker: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  bot: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  humanAgent: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  sybilAgent: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
};

function resolvePrivateKey(name: keyof AgentKeyEnvironment, value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte hexadecimal private key`);
  }
  return value as Hex;
}

export function resolveAgentKeys(env: AgentKeyEnvironment): Record<AgentRole, Hex> {
  return {
    maker: resolvePrivateKey('MAKER_PRIVATE_KEY', env.MAKER_PRIVATE_KEY ?? ANVIL_KEYS.maker),
    bot: resolvePrivateKey('BOT_PRIVATE_KEY', env.BOT_PRIVATE_KEY ?? ANVIL_KEYS.bot),
    humanAgent: resolvePrivateKey(
      'HUMAN_AGENT_PRIVATE_KEY',
      env.HUMAN_AGENT_PRIVATE_KEY ?? ANVIL_KEYS.humanAgent,
    ),
    sybilAgent: resolvePrivateKey(
      'SYBIL_AGENT_PRIVATE_KEY',
      env.SYBIL_AGENT_PRIVATE_KEY ?? ANVIL_KEYS.sybilAgent,
    ),
  };
}

export const KEYS = resolveAgentKeys(process.env);

export function loadDeployments() {
  const path =
    process.env.DEPLOYMENTS_PATH ??
    resolve(here, '../../contracts/deployments/world-mainnet.json');
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
      chainId: `eip155:${AGENTKIT_SIGNER_CHAIN_ID}`,
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
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export const routerAbi = [
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'maker', type: 'address' },
          { name: 'traits', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'takerTraitsAndData', type: 'bytes' },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'orderHash', type: 'bytes32' },
    ],
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
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  execute: {
    to: `0x${string}`;
    order: {
      maker: `0x${string}`;
      traits: string;
      data: Hex;
    };
  };
}

const ALLOWANCE_VISIBILITY_ATTEMPTS = 10;
const ALLOWANCE_VISIBILITY_INITIAL_DELAY_MS = 100;
const ALLOWANCE_VISIBILITY_MAX_DELAY_MS = 1_000;

async function waitForAllowanceVisibility(
  wallet: ReturnType<typeof makeWallet>,
  token: `0x${string}`,
  spender: `0x${string}`,
  requiredAllowance: bigint,
): Promise<void> {
  let lastAllowance = 0n;
  let lastReadError: unknown;

  for (let attempt = 0; attempt < ALLOWANCE_VISIBILITY_ATTEMPTS; attempt += 1) {
    try {
      lastAllowance = await wallet.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [wallet.account.address, spender],
      });
      lastReadError = undefined;
      if (lastAllowance >= requiredAllowance) return;
    } catch (error) {
      // A transient read failure can be another symptom of an RPC replica
      // changing underneath us. Keep polling within the same bounded budget.
      lastReadError = error;
    }

    if (attempt + 1 < ALLOWANCE_VISIBILITY_ATTEMPTS) {
      const delayMs = Math.min(
        ALLOWANCE_VISIBILITY_INITIAL_DELAY_MS * 2 ** attempt,
        ALLOWANCE_VISIBILITY_MAX_DELAY_MS,
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }

  const readFailure =
    lastReadError instanceof Error ? ` Last read failed: ${lastReadError.message}` : '';
  throw new Error(
    `RPC did not observe allowance ${requiredAllowance} for ${spender} after ` +
      `${ALLOWANCE_VISIBILITY_ATTEMPTS} attempts (last observed ${lastAllowance}).${readFailure}`,
  );
}

export async function executeSwap(
  wallet: ReturnType<typeof makeWallet>,
  quote: QuoteResponse,
  tokenIn: `0x${string}`,
  amountIn: bigint,
): Promise<{ amountOut: bigint; txHash: `0x${string}` }> {
  const order = {
    maker: quote.execute.order.maker,
    traits: BigInt(quote.execute.order.traits),
    data: quote.execute.order.data,
  };

  const approvalHash = await wallet.writeContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: 'approve',
    args: [quote.execute.to, amountIn],
    chain: null,
  });
  await wallet.waitForTransactionReceipt({ hash: approvalHash });

  // Some hosted RPCs acknowledge the approval receipt from one replica before
  // another replica serving eth_call has indexed the new allowance. Do not
  // simulate against stale state. Write-only wallet adapters retain the previous
  // receipt-only behavior because they cannot perform the visibility check.
  if (typeof wallet.readContract === 'function') {
    await waitForAllowanceVisibility(wallet, tokenIn, quote.execute.to, amountIn);
  }

  const slippageBps = BigInt(process.env.SLIPPAGE_BPS ?? '50');
  if (slippageBps < 0n || slippageBps >= 10_000n) {
    throw new Error(`SLIPPAGE_BPS must be between 0 and 9999, got ${slippageBps}`);
  }
  const amountOutMin = (BigInt(quote.amountOut) * (10_000n - slippageBps)) / 10_000n;
  const takerTraits = concatHex([
    `0x${'0020'.repeat(10)}` as Hex,
    '0x0041',
    padHex(toHex(amountOutMin), { size: 32 }),
  ]);
  const args = [
    order,
    quote.tokenIn,
    quote.tokenOut,
    amountIn,
    takerTraits,
  ] as const;

  const { result } = await wallet.simulateContract({
    address: quote.execute.to,
    abi: routerAbi,
    functionName: 'swap',
    args,
    account: wallet.account,
  });
  const txHash = await wallet.writeContract({
    address: quote.execute.to,
    abi: routerAbi,
    functionName: 'swap',
    args,
    chain: null,
  });
  await wallet.waitForTransactionReceipt({ hash: txHash });
  return { amountOut: result[1], txHash };
}

export function fmt(amount: string | bigint, decimals = 18, digits = 2): string {
  return Number(formatUnits(BigInt(amount), decimals)).toLocaleString('en-US', {
    maximumFractionDigits: digits,
  });
}
