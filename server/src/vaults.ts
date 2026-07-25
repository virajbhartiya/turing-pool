import {
  encodeFunctionData,
  getAddress,
  isAddress,
  maxUint256,
  type Address,
  type Hex,
} from 'viem';

import {
  agentBookAbi,
  erc20Abi,
  quotaAbi,
  routerAbi,
  vaultAbi,
  vaultFactoryAbi,
} from './abi.js';
import { client, deployments } from './chain.js';
import {
  applyFeeSchedule,
  buildTakerTraits,
  parseHumanGateProgram,
  parseWalletAddress,
  resolveHumanGateTier,
  type OnChainFeeSchedule,
  type RouterExecutionView,
} from './router-demo.js';

export type VaultTradeDirection = 'token0-to-token1' | 'token1-to-token0';
export type VaultAction = 'trade' | 'deposit' | 'redeem' | 'create';

interface PreparedVaultTransaction {
  action:
    | 'approve-token0'
    | 'approve-token1'
    | 'approve-trade-token'
    | 'deposit'
    | 'redeem'
    | 'swap'
    | 'create';
  transaction: {
    from: Address;
    to: Address;
    data: Hex;
    value: '0x0';
  };
  preview: Record<string, unknown>;
}

interface TokenMetadata {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
}

const ZERO_HASH = `0x${'00'.repeat(32)}` as Hex;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const tokenMetadataCache = new Map<string, Promise<TokenMetadata>>();

function configuredFactory(): Address | undefined {
  const value = process.env.VAULT_FACTORY ?? deployments.vaultFactory;
  return typeof value === 'string' && isAddress(value) ? getAddress(value) : undefined;
}

export function vaultsEnabled(): boolean {
  return configuredFactory() !== undefined;
}

function requireFactory(): Address {
  const factory = configuredFactory();
  if (!factory) {
    throw new Error('VAULT_FACTORY is not configured for this runtime');
  }
  return factory;
}

function parseContractAddress(value: unknown, label: string): Address {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value) || !isAddress(value)) {
    throw new Error(`${label} must be a valid EVM address`);
  }
  return getAddress(value);
}

function parseVaultAddress(value: unknown): Address {
  return parseContractAddress(value, 'vault');
}

function parseAmount(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw new Error(`${label} must be an unsigned integer in token base units`);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > typeUint128Max) {
    throw new Error(`${label} must be between 1 and ${typeUint128Max}`);
  }
  return parsed;
}

const typeUint128Max = (1n << 128n) - 1n;

function parseDecimalAmount(value: unknown, decimals: number, label: string): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    throw new Error(`${label} must be a positive token amount`);
  }
  const [whole = '0', fraction = ''] = value.split('.');
  if (fraction.length > decimals) {
    throw new Error(`${label} exceeds the token's ${decimals}-decimal precision`);
  }
  const amount =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (amount <= 0n || amount > typeUint128Max) {
    throw new Error(`${label} must be between 1 base unit and ${typeUint128Max}`);
  }
  return amount;
}

function parseDirection(value: unknown): VaultTradeDirection {
  if (value === undefined || value === 'token0-to-token1') return 'token0-to-token1';
  if (value === 'token1-to-token0') return value;
  throw new Error('direction must be token0-to-token1 or token1-to-token0');
}

function slippageBps(): bigint {
  const value = BigInt(process.env.SLIPPAGE_BPS ?? '50');
  if (value < 0n || value >= 10_000n) {
    throw new Error('SLIPPAGE_BPS must be between 0 and 9999');
  }
  return value;
}

async function metadata(token: Address): Promise<TokenMetadata> {
  const key = token.toLowerCase();
  let request = tokenMetadataCache.get(key);
  if (!request) {
    request = Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
      client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
      client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    ]).then(([name, symbol, decimals]) => ({
      address: token,
      name,
      symbol,
      decimals,
    }));
    tokenMetadataCache.set(key, request);
  }
  return request;
}

async function assertRegisteredVault(vault: Address): Promise<void> {
  const registered = await client.readContract({
    address: requireFactory(),
    abi: vaultFactoryAbi,
    functionName: 'isVault',
    args: [vault],
  });
  if (!registered) throw new Error('vault is not registered by the configured factory');
}

async function readFeeSchedule(quota: Address, token: Address): Promise<OnChainFeeSchedule> {
  const [tightFeeBps, wideFeeBps, targetFeeBps, humanShareBps, tightVolume, wideVolume] =
    await client.readContract({
      address: quota,
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

async function executionView(vault: Address): Promise<RouterExecutionView> {
  await assertRegisteredVault(vault);
  const [token0, token1, quota, router, orderHash, order] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'TOKEN0' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'TOKEN1' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'QUOTA' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'ROUTER' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'currentOrderHash' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'currentOrder' }),
  ]);
  if (orderHash === ZERO_HASH) throw new Error('vault has no active Aqua order; add liquidity first');
  const program = parseHumanGateProgram(order.data);
  if (
    order.maker.toLowerCase() !== vault.toLowerCase() ||
    program.quota.toLowerCase() !== quota.toLowerCase() ||
    program.agentBook.toLowerCase() !== deployments.agentBook.toLowerCase()
  ) {
    throw new Error('vault order does not match its maker, quota, or canonical AgentBook');
  }
  return {
    order,
    orderHash,
    token0,
    token1,
    strategy: {
      maker: vault,
      token0,
      token1,
      wideFeeBps: BigInt(program.wideFeeBps),
      tightFeeBps: BigInt(program.tightFeeBps),
      salt: ZERO_HASH,
    },
    program,
  };
}

export async function vaultRegistry(walletInput?: unknown) {
  const factory = configuredFactory();
  const chainId = await client.getChainId();
  if (!factory) {
    return {
      enabled: false,
      chainId,
      factory: null,
      router: null,
      vaults: [],
      wallet: null,
      reason: 'The HumanGate v2 vault factory has not been configured on this runtime.',
    };
  }
  const wallet = walletInput === undefined ? undefined : parseWalletAddress(walletInput);
  const [vaults, router] = await Promise.all([
    client.readContract({ address: factory, abi: vaultFactoryAbi, functionName: 'allVaults' }),
    client.readContract({ address: factory, abi: vaultFactoryAbi, functionName: 'ROUTER' }),
  ]);
  return {
    enabled: true,
    chainId,
    factory,
    router,
    vaults: vaults.slice(-50),
    wallet: wallet ?? null,
    reason: null,
  };
}

export async function vaultState(vaultInput: unknown, walletInput?: unknown) {
  const vault = parseVaultAddress(vaultInput);
  const wallet = walletInput === undefined ? undefined : parseWalletAddress(walletInput);
  await assertRegisteredVault(vault);
  const [
    token0,
    token1,
    quota,
    router,
    manager,
    shareName,
    shareSymbol,
    totalSupply,
    reserves,
    strategyActive,
    paused,
    orderHash,
  ] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'TOKEN0' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'TOKEN1' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'QUOTA' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'ROUTER' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'owner' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'name' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'symbol' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'totalSupply' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'reserves' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'strategyActive' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'paused' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'currentOrderHash' }),
  ]);
  const [token0Meta, token1Meta, fee0, fee1] = await Promise.all([
    metadata(token0),
    metadata(token1),
    readFeeSchedule(quota, token0),
    readFeeSchedule(quota, token1),
  ]);
  const [shares, token0Balance, token1Balance, token0Allowance, token1Allowance] = wallet
    ? await Promise.all([
        client.readContract({ address: vault, abi: vaultAbi, functionName: 'balanceOf', args: [wallet] }),
        client.readContract({ address: token0, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
        client.readContract({ address: token1, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
        client.readContract({
          address: token0,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [wallet, vault],
        }),
        client.readContract({
          address: token1,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [wallet, vault],
        }),
      ])
    : ([0n, 0n, 0n, 0n, 0n] as const);
  return {
    vault,
    factory: requireFactory(),
    router,
    quota,
    manager,
    shareToken: { address: vault, name: shareName, symbol: shareSymbol, decimals: 18 },
    token0: token0Meta,
    token1: token1Meta,
    reserves: { token0: reserves[0].toString(), token1: reserves[1].toString() },
    totalSupply: totalSupply.toString(),
    strategyActive,
    paused,
    orderHash,
    feeSchedules: {
      token0: scheduleJson(fee0),
      token1: scheduleJson(fee1),
    },
    position: {
      wallet: wallet ?? null,
      shares: shares.toString(),
      token0Balance: token0Balance.toString(),
      token1Balance: token1Balance.toString(),
      token0Allowance: token0Allowance.toString(),
      token1Allowance: token1Allowance.toString(),
    },
  };
}

function scheduleJson(schedule: OnChainFeeSchedule) {
  return {
    tightFeeBps: schedule.tightFeeBps.toString(),
    wideFeeBps: schedule.wideFeeBps.toString(),
    targetFeeBps: schedule.targetFeeBps.toString(),
    humanShareBps: schedule.humanShareBps.toString(),
    tightVolume: schedule.tightVolume.toString(),
    wideVolume: schedule.wideVolume.toString(),
  };
}

export async function quoteVaultWallet(
  vaultInput: unknown,
  walletInput: unknown,
  amountInput: unknown,
  directionInput: unknown,
) {
  const vault = parseVaultAddress(vaultInput);
  const wallet = parseWalletAddress(walletInput);
  const amountIn = parseAmount(amountInput, 'amountIn');
  const direction = parseDirection(directionInput);
  const view = await executionView(vault);
  const router = await vaultRouter(vault);
  const zeroForOne = direction === 'token0-to-token1';
  const tokenIn = zeroForOne ? view.token0 : view.token1;
  const tokenOut = zeroForOne ? view.token1 : view.token0;
  const [inputMeta, outputMeta, feeSchedule, humanId, balance, allowance] = await Promise.all([
    metadata(tokenIn),
    metadata(tokenOut),
    readFeeSchedule(view.program.quota, tokenIn),
    client.readContract({
      address: view.program.agentBook,
      abi: agentBookAbi,
      functionName: 'lookupHuman',
      args: [wallet],
    }),
    client.readContract({ address: tokenIn, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
    client.readContract({
      address: tokenIn,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [wallet, router],
    }),
  ]);
  const [quotedAmountIn, amountOut, orderHash] = await client.readContract({
    address: router,
    abi: routerAbi,
    functionName: 'quote',
    args: [view.order, tokenIn, tokenOut, amountIn, buildTakerTraits()],
    account: wallet,
  });
  if (
    quotedAmountIn !== amountIn ||
    amountOut <= 0n ||
    orderHash.toLowerCase() !== view.orderHash.toLowerCase()
  ) {
    throw new Error('SwapVM returned an invalid quote for the selected vault order');
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
  const program = applyFeeSchedule(view.program, feeSchedule);
  const tier = resolveHumanGateTier(program, humanId, remaining, amountIn);
  return {
    vault,
    router,
    orderHash,
    wallet,
    direction,
    tokenIn: inputMeta,
    tokenOut: outputMeta,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    balance: balance.toString(),
    allowance: allowance.toString(),
    humanId: humanId.toString(),
    humanBacked: humanId !== 0n,
    tight: tier.tight,
    tier: tier.tight ? 'tight' : 'wide',
    feeBps: Number(tier.feeBps),
    sufficientBalance: balance >= amountIn,
    requiresApproval: allowance < amountIn,
    feeSchedule: scheduleJson(feeSchedule),
  };
}

async function vaultRouter(vault: Address): Promise<Address> {
  return client.readContract({ address: vault, abi: vaultAbi, functionName: 'ROUTER' });
}

export async function prepareVaultTrade(
  vaultInput: unknown,
  walletInput: unknown,
  amountInput: unknown,
  directionInput: unknown,
): Promise<PreparedVaultTransaction> {
  const quote = await quoteVaultWallet(vaultInput, walletInput, amountInput, directionInput);
  if (!quote.sufficientBalance) {
    throw new Error(
      `insufficient ${quote.tokenIn.symbol} balance: wallet has ${quote.balance}, requires ${quote.amountIn}`,
    );
  }
  if (quote.requiresApproval) {
    return {
      action: 'approve-trade-token',
      transaction: {
        from: quote.wallet,
        to: quote.tokenIn.address,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [quote.router, maxUint256],
        }),
        value: '0x0',
      },
      preview: quote,
    };
  }
  const view = await executionView(quote.vault);
  const minimumAmountOut =
    (BigInt(quote.amountOut) * (10_000n - slippageBps())) / 10_000n;
  const args = [
    view.order,
    quote.tokenIn.address,
    quote.tokenOut.address,
    BigInt(quote.amountIn),
    buildTakerTraits(minimumAmountOut),
  ] as const;
  await client.simulateContract({
    address: quote.router,
    abi: routerAbi,
    functionName: 'swap',
    args,
    account: quote.wallet,
  });
  return {
    action: 'swap',
    transaction: {
      from: quote.wallet,
      to: quote.router,
      data: encodeFunctionData({ abi: routerAbi, functionName: 'swap', args }),
      value: '0x0',
    },
    preview: quote,
  };
}

export async function prepareVaultLiquidity(
  vaultInput: unknown,
  walletInput: unknown,
  actionInput: unknown,
  body: Record<string, unknown>,
): Promise<PreparedVaultTransaction> {
  const vault = parseVaultAddress(vaultInput);
  const wallet = parseWalletAddress(walletInput);
  await assertRegisteredVault(vault);
  const action = actionInput;
  if (action === 'deposit') {
    const maxAmount0 = parseAmount(body.maxAmount0, 'maxAmount0');
    const maxAmount1 = parseAmount(body.maxAmount1, 'maxAmount1');
    const [token0, token1, preview] = await Promise.all([
      client.readContract({ address: vault, abi: vaultAbi, functionName: 'TOKEN0' }),
      client.readContract({ address: vault, abi: vaultAbi, functionName: 'TOKEN1' }),
      client.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: 'previewDeposit',
        args: [maxAmount0, maxAmount1],
      }),
    ]);
    if (preview[0] === 0n) throw new Error('deposit preview returned zero LP shares');
    const [allowance0, allowance1, balance0, balance1] = await Promise.all([
      client.readContract({
        address: token0,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [wallet, vault],
      }),
      client.readContract({
        address: token1,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [wallet, vault],
      }),
      client.readContract({ address: token0, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
      client.readContract({ address: token1, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
    ]);
    if (balance0 < preview[1] || balance1 < preview[2]) {
      throw new Error('insufficient token balance for the proportional deposit');
    }
    if (allowance0 < preview[1]) return approval(wallet, token0, vault, 'approve-token0', preview);
    if (allowance1 < preview[2]) return approval(wallet, token1, vault, 'approve-token1', preview);
    const minShares = (preview[0] * (10_000n - slippageBps())) / 10_000n;
    const args = [maxAmount0, maxAmount1, minShares, wallet] as const;
    await client.simulateContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'deposit',
      args,
      account: wallet,
    });
    return {
      action: 'deposit',
      transaction: {
        from: wallet,
        to: vault,
        data: encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args }),
        value: '0x0',
      },
      preview: {
        shares: preview[0].toString(),
        amount0: preview[1].toString(),
        amount1: preview[2].toString(),
      },
    };
  }
  if (action === 'redeem') {
    const shares = parseAmount(body.shares, 'shares');
    const [ownedShares, preview] = await Promise.all([
      client.readContract({ address: vault, abi: vaultAbi, functionName: 'balanceOf', args: [wallet] }),
      client.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: 'previewRedeem',
        args: [shares],
      }),
    ]);
    if (ownedShares < shares) throw new Error('insufficient LP shares for this redemption');
    const minAmount0 = (preview[0] * (10_000n - slippageBps())) / 10_000n;
    const minAmount1 = (preview[1] * (10_000n - slippageBps())) / 10_000n;
    const args = [shares, minAmount0, minAmount1, wallet] as const;
    await client.simulateContract({
      address: vault,
      abi: vaultAbi,
      functionName: 'redeem',
      args,
      account: wallet,
    });
    return {
      action: 'redeem',
      transaction: {
        from: wallet,
        to: vault,
        data: encodeFunctionData({ abi: vaultAbi, functionName: 'redeem', args }),
        value: '0x0',
      },
      preview: {
        shares: shares.toString(),
        amount0: preview[0].toString(),
        amount1: preview[1].toString(),
      },
    };
  }
  throw new Error('liquidity action must be deposit or redeem');
}

function approval(
  wallet: Address,
  token: Address,
  spender: Address,
  action: 'approve-token0' | 'approve-token1',
  preview: readonly [bigint, bigint, bigint],
): PreparedVaultTransaction {
  return {
    action,
    transaction: {
      from: wallet,
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, maxUint256],
      }),
      value: '0x0',
    },
    preview: {
      shares: preview[0].toString(),
      amount0: preview[1].toString(),
      amount1: preview[2].toString(),
    },
  };
}

export async function prepareCreateVault(
  walletInput: unknown,
  body: Record<string, unknown>,
): Promise<PreparedVaultTransaction> {
  const factory = requireFactory();
  const wallet = parseWalletAddress(walletInput);
  const token0 = parseContractAddress(body.token0, 'token0');
  const token1 = parseContractAddress(body.token1, 'token1');
  if (token0.toLowerCase() === token1.toLowerCase()) {
    throw new Error('token0 and token1 must be different contracts');
  }
  const [token0Meta, token1Meta] = await Promise.all([metadata(token0), metadata(token1)]);
  const dailyCap0 = parseDecimalAmount(body.dailyCap0, token0Meta.decimals, 'dailyCap0');
  const dailyCap1 = parseDecimalAmount(body.dailyCap1, token1Meta.decimals, 'dailyCap1');
  const config = {
    token0,
    token1,
    manager: wallet,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 64) : 'Turing Pool LP',
    symbol: typeof body.symbol === 'string' && body.symbol.trim() ? body.symbol.trim().slice(0, 16) : 'tpLP',
    dailyCap0,
    dailyCap1,
    targetFeeBps: 30,
    desiredTightFeeBps: 5,
    maxWideFeeBps: 100,
    initialTightFeeBps: 20,
    initialWideFeeBps: 50,
    seedToken0TightVolume: 0n,
    seedToken0WideVolume: 0n,
    seedToken1TightVolume: 0n,
    seedToken1WideVolume: 0n,
  } as const;
  await client.simulateContract({
    address: factory,
    abi: vaultFactoryAbi,
    functionName: 'createVault',
    args: [config],
    account: wallet,
  });
  return {
    action: 'create',
    transaction: {
      from: wallet,
      to: factory,
      data: encodeFunctionData({
        abi: vaultFactoryAbi,
        functionName: 'createVault',
        args: [config],
      }),
      value: '0x0',
    },
    preview: {
      token0,
      token1,
      dailyCap0: dailyCap0.toString(),
      dailyCap1: dailyCap1.toString(),
      targetFeeBps: 30,
    },
  };
}
