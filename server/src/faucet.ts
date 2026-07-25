import {
  encodeFunctionData,
  getAddress,
  isAddress,
  type Address,
} from 'viem';

import { erc20Abi, faucetAbi } from './abi.js';
import { client, deployments } from './chain.js';
import { CHAIN_ID } from './config.js';

function configuredFaucet(): Address | undefined {
  const value = process.env.FAUCET_ADDRESS ?? deployments.faucet;
  return typeof value === 'string' && isAddress(value) ? getAddress(value) : undefined;
}

function parseWallet(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error('wallet address must be a valid EVM address');
  }
  return getAddress(value);
}

async function tokenState(token: Address, faucet: Address, wallet?: Address) {
  const [name, symbol, decimals, faucetBalance, walletBalance] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [faucet],
    }),
    wallet
      ? client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [wallet],
        })
      : Promise.resolve(0n),
  ]);
  return {
    address: token,
    name,
    symbol,
    decimals,
    faucetBalance: faucetBalance.toString(),
    walletBalance: walletBalance.toString(),
  };
}

export async function faucetState(walletValue?: unknown) {
  const faucet = configuredFaucet();
  if (!faucet) {
    return {
      enabled: false as const,
      chainId: CHAIN_ID,
      faucet: null,
      wallet: null,
      reason: 'The public test-token faucet is not configured.',
    };
  }

  const wallet =
    walletValue === undefined || walletValue === ''
      ? undefined
      : parseWallet(walletValue);
  const [token0, token1, claimAmount0, claimAmount1, cooldown, remainingClaims, block] =
    await Promise.all([
      client.readContract({ address: faucet, abi: faucetAbi, functionName: 'TOKEN0' }),
      client.readContract({ address: faucet, abi: faucetAbi, functionName: 'TOKEN1' }),
      client.readContract({
        address: faucet,
        abi: faucetAbi,
        functionName: 'CLAIM_AMOUNT0',
      }),
      client.readContract({
        address: faucet,
        abi: faucetAbi,
        functionName: 'CLAIM_AMOUNT1',
      }),
      client.readContract({ address: faucet, abi: faucetAbi, functionName: 'COOLDOWN' }),
      client.readContract({
        address: faucet,
        abi: faucetAbi,
        functionName: 'remainingClaims',
      }),
      client.getBlock({ blockTag: 'latest' }),
    ]);
  const [asset0, asset1, nextClaimAt] = await Promise.all([
    tokenState(token0, faucet, wallet),
    tokenState(token1, faucet, wallet),
    wallet
      ? client.readContract({
          address: faucet,
          abi: faucetAbi,
          functionName: 'nextClaimAt',
          args: [wallet],
        })
      : Promise.resolve(0n),
  ]);
  const timestamp = block.timestamp;
  const inventoryAvailable = remainingClaims > 0n;
  const cooldownComplete = nextClaimAt <= timestamp;

  return {
    enabled: true as const,
    chainId: CHAIN_ID,
    faucet,
    wallet: wallet ?? null,
    token0: { ...asset0, claimAmount: claimAmount0.toString() },
    token1: { ...asset1, claimAmount: claimAmount1.toString() },
    cooldownSeconds: cooldown.toString(),
    nextClaimAt: nextClaimAt.toString(),
    serverTimestamp: timestamp.toString(),
    remainingClaims: remainingClaims.toString(),
    inventoryAvailable,
    claimable: Boolean(wallet && inventoryAvailable && cooldownComplete),
    reason: !wallet
      ? 'Connect a wallet to claim test assets.'
      : !inventoryAvailable
        ? 'The faucet is temporarily empty.'
        : !cooldownComplete
          ? 'This wallet is still in its claim cooldown.'
          : null,
  };
}

export async function prepareFaucetClaim(walletValue: unknown) {
  const wallet = parseWallet(walletValue);
  const state = await faucetState(wallet);
  if (!state.enabled || !state.faucet) {
    throw new Error(state.reason);
  }
  if (!state.inventoryAvailable) {
    throw new Error('The faucet is temporarily empty.');
  }
  if (!state.claimable) {
    throw new Error(`This wallet can claim again at ${state.nextClaimAt}.`);
  }

  await client.simulateContract({
    account: wallet,
    address: state.faucet,
    abi: faucetAbi,
    functionName: 'claim',
  });

  return {
    action: 'claim' as const,
    state,
    transaction: {
      from: wallet,
      to: state.faucet,
      data: encodeFunctionData({ abi: faucetAbi, functionName: 'claim' }),
      value: '0x0' as const,
    },
  };
}
