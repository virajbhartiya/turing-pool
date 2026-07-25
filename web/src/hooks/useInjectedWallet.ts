import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ensureExecutionChain,
  normalizeAccounts,
  parseChainId,
  EXECUTION_CHAIN_ID,
  type Eip1193Provider,
} from '../lib/wallet';

const SESSION_ACCOUNT_KEY = 'turing-pool.connected-account';

function preferredAccount(accounts: string[]): string | undefined {
  const stored = window.sessionStorage.getItem(SESSION_ACCOUNT_KEY);
  return accounts.find((account) => account.toLowerCase() === stored?.toLowerCase()) ?? accounts[0];
}

export function useInjectedWallet() {
  const provider = window.ethereum;
  const [accounts, setAccounts] = useState<string[]>([]);
  const [account, setAccount] = useState<string>();
  const [chainId, setChainId] = useState<number>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();

  const applyAccounts = useCallback((value: unknown) => {
    const next = normalizeAccounts(value);
    setAccounts(next);
    setAccount((current) => {
      const selected =
        next.find((candidate) => candidate.toLowerCase() === current?.toLowerCase()) ??
        preferredAccount(next);
      if (selected) window.sessionStorage.setItem(SESSION_ACCOUNT_KEY, selected);
      else window.sessionStorage.removeItem(SESSION_ACCOUNT_KEY);
      return selected;
    });
  }, []);

  useEffect(() => {
    if (!provider) return;
    const accountsChanged = (value: unknown) => applyAccounts(value);
    const chainChanged = (value: unknown) => setChainId(parseChainId(value));
    provider.on?.('accountsChanged', accountsChanged);
    provider.on?.('chainChanged', chainChanged);
    void Promise.all([
      provider.request({ method: 'eth_accounts' }),
      provider.request({ method: 'eth_chainId' }),
    ]).then(([availableAccounts, activeChain]) => {
      applyAccounts(availableAccounts);
      setChainId(parseChainId(activeChain));
    });
    return () => {
      provider.removeListener?.('accountsChanged', accountsChanged);
      provider.removeListener?.('chainChanged', chainChanged);
    };
  }, [applyAccounts, provider]);

  const connect = useCallback(
    async (requestAccountSelection = false) => {
      if (!provider) {
        setError('MetaMask was not detected in this browser.');
        return;
      }
      setConnecting(true);
      setError(undefined);
      try {
        if (requestAccountSelection) {
          await provider.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }],
          });
        }
        const connectedAccounts = await provider.request({ method: 'eth_requestAccounts' });
        await ensureExecutionChain(provider);
        applyAccounts(connectedAccounts);
        setChainId(EXECUTION_CHAIN_ID);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Wallet connection was cancelled.');
      } finally {
        setConnecting(false);
      }
    },
    [applyAccounts, provider],
  );

  const selectAccount = useCallback(
    (nextAccount: string) => {
      const matched = accounts.find(
        (candidate) => candidate.toLowerCase() === nextAccount.toLowerCase(),
      );
      if (!matched) return;
      window.sessionStorage.setItem(SESSION_ACCOUNT_KEY, matched);
      setAccount(matched);
    },
    [accounts],
  );

  return useMemo(
    () => ({
      installed: provider !== undefined,
      provider: provider as Eip1193Provider | undefined,
      accounts,
      account,
      chainId,
      connected: account !== undefined,
      correctChain: chainId === EXECUTION_CHAIN_ID,
      connecting,
      error,
      connect,
      selectAccount,
    }),
    [account, accounts, chainId, connect, connecting, error, provider, selectAccount],
  );
}
