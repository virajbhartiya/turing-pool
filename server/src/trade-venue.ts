import { getAddress, isAddress, type Address } from 'viem';

import { client, deployments } from './chain.js';
import { DEFAULT_SLIPPAGE_BPS } from './slippage.js';
import type { DemoTradeDirection } from './demo.js';
import {
  confirmConnectedWalletTrade,
  prepareConnectedWalletTrade,
  quoteComparisonWallet,
  quoteConnectedWallet,
  routerPoolState,
  type ConnectedWalletPreparation,
  type ConnectedWalletQuote,
  type DemoTradeResult,
} from './router-demo.js';
import {
  confirmVaultWalletTrade,
  prepareVaultTrade,
  quoteVaultWallet,
  vaultDirectionForPair,
  vaultPoolState,
  type VaultWalletQuote,
} from './vaults.js';

export interface WebsiteTradeVenueConfig {
  primaryRouter: Address;
  vaultRouter?: Address;
  activeVault?: Address;
  vaultFactory?: Address;
}

export type WebsiteTradeVenue =
  | { kind: 'primary'; router: Address }
  | { kind: 'vault'; router: Address; vault: Address };

export function resolveWebsiteTradeVenue(
  config: WebsiteTradeVenueConfig,
): WebsiteTradeVenue {
  if (config.vaultFactory && config.vaultRouter && config.activeVault) {
    return {
      kind: 'vault',
      router: config.vaultRouter,
      vault: config.activeVault,
    };
  }
  return {
    kind: 'primary',
    router: config.primaryRouter,
  };
}

function optionalAddress(value: unknown): Address | undefined {
  return typeof value === 'string' && isAddress(value) ? getAddress(value) : undefined;
}

export function websiteTradeVenue(): WebsiteTradeVenue {
  return resolveWebsiteTradeVenue({
    primaryRouter: deployments.router,
    vaultFactory: optionalAddress(process.env.VAULT_FACTORY ?? deployments.vaultFactory),
    vaultRouter: optionalAddress(deployments.vaultRouter),
    activeVault: optionalAddress(deployments.activeVault),
  });
}

export async function websitePoolState() {
  const venue = websiteTradeVenue();
  return venue.kind === 'vault'
    ? vaultPoolState(venue.vault)
    : routerPoolState();
}

function expectedPair(direction: DemoTradeDirection) {
  return direction === 'tETH-to-tUSD'
    ? {
        tokenIn: deployments.tETH,
        tokenOut: deployments.tUSD,
        tokenInSymbol: 'tETH' as const,
        tokenOutSymbol: 'tUSD' as const,
      }
    : {
        tokenIn: deployments.tUSD,
        tokenOut: deployments.tETH,
        tokenInSymbol: 'tUSD' as const,
        tokenOutSymbol: 'tETH' as const,
      };
}

async function vaultDirection(vault: Address, direction: DemoTradeDirection) {
  const pair = expectedPair(direction);
  return vaultDirectionForPair(vault, pair.tokenIn, pair.tokenOut);
}

function assertVaultQuotePair(quote: VaultWalletQuote, direction: DemoTradeDirection): void {
  const pair = expectedPair(direction);
  if (
    quote.tokenIn.address.toLowerCase() !== pair.tokenIn.toLowerCase() ||
    quote.tokenOut.address.toLowerCase() !== pair.tokenOut.toLowerCase()
  ) {
    throw new Error('configured website vault returned an unexpected trading pair');
  }
}

async function connectedQuoteFromVault(
  quote: VaultWalletQuote,
  direction: DemoTradeDirection,
): Promise<ConnectedWalletQuote> {
  assertVaultQuotePair(quote, direction);
  const pair = expectedPair(direction);
  return {
    wallet: quote.wallet,
    chainId: await client.getChainId(),
    direction,
    tokenIn: quote.tokenIn.address,
    tokenOut: quote.tokenOut.address,
    tokenInSymbol: pair.tokenInSymbol,
    tokenOutSymbol: pair.tokenOutSymbol,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    balance: quote.balance,
    allowance: quote.allowance,
    humanId: quote.humanId,
    humanBacked: quote.humanBacked,
    tight: quote.tight,
    tier: quote.tier,
    feeBps: quote.feeBps,
    sufficientBalance: quote.sufficientBalance,
    requiresApproval: quote.requiresApproval,
    router: quote.router,
    quota: quote.quota,
    feeSchedule: quote.feeSchedule,
  };
}

export async function quoteWebsiteWallet(
  walletInput: unknown,
  amountIn: bigint,
  direction: DemoTradeDirection,
): Promise<ConnectedWalletQuote> {
  const venue = websiteTradeVenue();
  if (venue.kind === 'primary') {
    return quoteConnectedWallet(walletInput, amountIn, direction);
  }
  const quote = await quoteVaultWallet(
    venue.vault,
    walletInput,
    amountIn.toString(),
    await vaultDirection(venue.vault, direction),
  );
  return connectedQuoteFromVault(quote, direction);
}

export async function quoteWebsiteComparisonWallet(
  walletInput: unknown,
  amountIn: bigint,
  direction: DemoTradeDirection,
): Promise<ConnectedWalletQuote> {
  const venue = websiteTradeVenue();
  if (venue.kind === 'primary') {
    return quoteComparisonWallet(walletInput, amountIn, direction);
  }
  const quote = await quoteVaultWallet(
    venue.vault,
    walletInput,
    amountIn.toString(),
    await vaultDirection(venue.vault, direction),
  );
  return connectedQuoteFromVault(quote, direction);
}

export async function prepareWebsiteWalletTrade(
  walletInput: unknown,
  amountIn: bigint,
  direction: DemoTradeDirection,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): Promise<ConnectedWalletPreparation> {
  const venue = websiteTradeVenue();
  if (venue.kind === 'primary') {
    return prepareConnectedWalletTrade(walletInput, amountIn, direction, slippageBps);
  }
  const prepared = await prepareVaultTrade(
    venue.vault,
    walletInput,
    amountIn.toString(),
    await vaultDirection(venue.vault, direction),
    slippageBps,
  );
  return {
    quote: await connectedQuoteFromVault(prepared.preview, direction),
    action: prepared.action === 'swap' ? 'swap' : 'approve',
    transaction: prepared.transaction,
  };
}

export async function confirmWebsiteWalletTrade(
  walletInput: unknown,
  transactionHashInput: unknown,
  direction: DemoTradeDirection,
  approvalTransactionHashInput?: unknown,
): Promise<DemoTradeResult> {
  const venue = websiteTradeVenue();
  if (venue.kind === 'primary') {
    return confirmConnectedWalletTrade(
      walletInput,
      transactionHashInput,
      direction,
      approvalTransactionHashInput,
    );
  }
  const confirmed = await confirmVaultWalletTrade(
    venue.vault,
    walletInput,
    transactionHashInput,
    await vaultDirection(venue.vault, direction),
    approvalTransactionHashInput,
  );
  const pair = expectedPair(direction);
  if (
    confirmed.tokenIn.address.toLowerCase() !== pair.tokenIn.toLowerCase() ||
    confirmed.tokenOut.address.toLowerCase() !== pair.tokenOut.toLowerCase()
  ) {
    throw new Error('confirmed website vault receipt contains an unexpected trading pair');
  }
  if (confirmed.opcode !== 34) {
    throw new Error(`confirmed website vault used unexpected opcode ${confirmed.opcode}`);
  }
  return {
    lane: confirmed.humanBacked ? 'human' : 'bot',
    direction,
    zeroForOne: direction === 'tETH-to-tUSD',
    tokenIn: confirmed.tokenIn.address,
    tokenOut: confirmed.tokenOut.address,
    tokenInSymbol: pair.tokenInSymbol,
    tokenOutSymbol: pair.tokenOutSymbol,
    wallet: confirmed.wallet,
    transactionHash: confirmed.transactionHash,
    approvalTransactionHash: confirmed.approvalTransactionHash,
    blockNumber: confirmed.blockNumber,
    amountIn: confirmed.amountIn,
    amountOut: confirmed.amountOut,
    orderHash: confirmed.orderHash,
    opcode: confirmed.opcode,
    event: confirmed.event,
    humanId: confirmed.humanId,
    humanBacked: confirmed.humanBacked,
    tight: confirmed.tight,
    tier: confirmed.tier,
    feeBps: confirmed.feeBps,
    quotedFeeSchedule: confirmed.quotedFeeSchedule,
    explorerUrl: confirmed.explorerUrl,
  };
}
