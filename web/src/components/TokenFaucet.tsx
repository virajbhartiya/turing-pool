import { useCallback, useEffect, useState } from 'react';

import { apiBase } from '../hooks/useProtocol';
import { responseJson } from '../lib/apiResponse';
import { formatUnits, transactionExplorer } from '../lib/format';
import {
  addTokenToWallet,
  ensureExecutionChain,
  sendWalletTransaction,
  waitForWalletReceipt,
  type Eip1193Provider,
} from '../lib/wallet';
import type { FaucetState, PreparedFaucetClaim } from '../types';

interface TokenFaucetProps {
  account?: string;
  provider?: Eip1193Provider;
  walletInstalled: boolean;
  walletConnecting: boolean;
  onConnectWallet: (requestAccountSelection?: boolean) => Promise<void>;
  onClaimed: () => Promise<void>;
}

type ClaimPhase = 'idle' | 'preparing' | 'signing' | 'mining' | 'complete';

async function readFaucet(account?: string): Promise<FaucetState> {
  const params = account ? `?${new URLSearchParams({ address: account })}` : '';
  const response = await fetch(`${apiBase()}/faucet${params}`);
  const body = await responseJson<FaucetState | { error?: string }>(response, 'Faucet API');
  if (!('enabled' in body)) {
    throw new Error('error' in body && body.error ? body.error : 'Test-token faucet is unavailable');
  }
  return body;
}

function availabilityLabel(state?: FaucetState): string {
  if (!state?.enabled) return state?.reason ?? 'Faucet unavailable';
  if (!state.wallet) return 'Connect a wallet to claim';
  if (!state.inventoryAvailable) return 'Faucet inventory depleted';
  if (state.claimable) return 'Ready to claim';
  if (state.nextClaimAt && state.nextClaimAt !== '0') {
    return `Available ${new Date(Number(state.nextClaimAt) * 1_000).toLocaleString()}`;
  }
  return state.reason ?? 'Claim unavailable';
}

export function TokenFaucet({
  account,
  provider,
  walletInstalled,
  walletConnecting,
  onConnectWallet,
  onClaimed,
}: TokenFaucetProps) {
  const [state, setState] = useState<FaucetState>();
  const [phase, setPhase] = useState<ClaimPhase>('idle');
  const [error, setError] = useState<string>();
  const [transactionHash, setTransactionHash] = useState<string>();

  const refresh = useCallback(async () => {
    const next = await readFaucet(account);
    setState(next);
    return next;
  }, [account]);

  useEffect(() => {
    setState(undefined);
    setError(undefined);
    setTransactionHash(undefined);
    setPhase('idle');
    void refresh().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'Test-token faucet is unavailable');
    });
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function claim() {
    if (!account || !provider) {
      await onConnectWallet(false);
      return;
    }
    setError(undefined);
    setTransactionHash(undefined);
    try {
      setPhase('preparing');
      const response = await fetch(`${apiBase()}/faucet/prepare`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: account }),
      });
      const body = await responseJson<PreparedFaucetClaim | { error?: string }>(response, 'Faucet API');
      if (!('transaction' in body)) {
        throw new Error('error' in body && body.error ? body.error : 'Faucet claim could not be prepared');
      }

      await ensureExecutionChain(provider, body.state.chainId);
      setState(body.state);
      setPhase('signing');
      const hash = await sendWalletTransaction(provider, body.transaction);
      setTransactionHash(hash);
      setPhase('mining');
      await waitForWalletReceipt(provider, hash);
      setPhase('complete');
      await Promise.all([refresh(), onClaimed()]);
    } catch (caught) {
      setPhase('idle');
      setError(caught instanceof Error ? caught.message : 'Faucet claim failed');
    }
  }

  async function addAssets() {
    if (!provider || !state?.token0 || !state.token1) return;
    try {
      await addTokenToWallet(provider, state.token0);
      await addTokenToWallet(provider, state.token1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The wallet could not add the assets');
    }
  }

  const working = ['preparing', 'signing', 'mining'].includes(phase);
  const buttonLabel = !account
    ? walletConnecting
      ? 'Opening wallet…'
      : walletInstalled
        ? 'Connect wallet to claim'
        : 'Install a browser wallet'
    : phase === 'preparing'
      ? 'Simulating claim…'
      : phase === 'signing'
        ? 'Confirm in wallet…'
        : phase === 'mining'
          ? 'Claim is mining…'
          : state?.claimable
            ? 'Claim test assets'
            : availabilityLabel(state);
  const receipt = transactionExplorer(state?.chainId ?? 480, transactionHash);

  return (
    <article className="token-faucet">
      <header>
        <div>
          <span>Get started</span>
          <h2>Get test tokens</h2>
        </div>
        <b className={state?.claimable ? 'ready' : ''}>
          {state?.enabled ? 'Available' : 'Unavailable'}
        </b>
      </header>

      <div className="faucet-bundle">
        <div>
          <span>YOU RECEIVE</span>
          <strong>
            {state?.token0 ? formatUnits(state.token0.claimAmount, state.token0.decimals, 2) : '1'}{' '}
            <em>{state?.token0?.symbol ?? 'tETH'}</em>
          </strong>
        </div>
        <i>+</i>
        <div>
          <span>PLUS</span>
          <strong>
            {state?.token1 ? formatUnits(state.token1.claimAmount, state.token1.decimals, 0) : '4,000'}{' '}
            <em>{state?.token1?.symbol ?? 'tUSD'}</em>
          </strong>
        </div>
        <small>Once every 24 hours</small>
      </div>

      {account && state?.token0 && state.token1 && (
        <div className="faucet-wallet-balances">
          <span>Current wallet balance</span>
          <b>{formatUnits(state.token0.walletBalance, state.token0.decimals, 4)} {state.token0.symbol}</b>
          <b>{formatUnits(state.token1.walletBalance, state.token1.decimals, 2)} {state.token1.symbol}</b>
        </div>
      )}

      <button
        className="faucet-claim-button"
        disabled={
          working ||
          walletConnecting ||
          (!walletInstalled && !account) ||
          (Boolean(account) && !state?.claimable)
        }
        onClick={() => void claim()}
        type="button"
      >
        {buttonLabel}
      </button>

      <footer>
        <span>{availabilityLabel(state)}</span>
        {phase === 'complete' && (
          <button onClick={() => void addAssets()} type="button">
            Add assets to wallet
          </button>
        )}
        {receipt && <a href={receipt} rel="noreferrer" target="_blank">View receipt ↗</a>}
      </footer>
      {error && <p className="faucet-error">{error}</p>}
    </article>
  );
}
