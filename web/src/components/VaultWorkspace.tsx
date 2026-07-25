import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiBase } from '../hooks/useProtocol';
import { responseJson } from '../lib/apiResponse';
import {
  addressExplorer,
  formatSignedUnits,
  formatUnits,
  parseUnits,
  shortAddress,
  transactionExplorer,
  unitsAsNumber,
} from '../lib/format';
import {
  addTokenToWallet,
  ensureExecutionChain,
  sendWalletTransaction,
  waitForWalletReceipt,
  type Eip1193Provider,
} from '../lib/wallet';
import type {
  PreparedVaultAction,
  VaultRegistry,
  VaultState,
} from '../types';

type WorkspaceAction = 'deposit' | 'redeem';

interface VaultWorkspaceProps {
  account?: string;
  provider?: Eip1193Provider;
  onConnectWallet: (requestAccountSelection?: boolean) => Promise<void>;
  onProtocolRefresh: () => Promise<void>;
}

interface ActionStatus {
  state: 'idle' | 'preparing' | 'wallet' | 'mining' | 'confirmed' | 'error';
  title: string;
  detail: string;
  transactionHash?: string;
}

const IDLE_STATUS: ActionStatus = {
  state: 'idle',
  title: 'Ready',
  detail: 'Every state-changing action is simulated before your wallet opens.',
};

const ACTIONS = ['deposit', 'redeem'] as const;
const MINIMUM_LIQUIDITY = 1_000n;

function waitForRpcVisibility(milliseconds = 650): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function squareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let previous = value;
  let next = (previous + value / previous) / 2n;
  while (next < previous) {
    previous = next;
    next = (previous + value / previous) / 2n;
  }
  return previous;
}

function ceilMulDiv(value: bigint, multiplier: bigint, denominator: bigint): bigint {
  const product = value * multiplier;
  return (product + denominator - 1n) / denominator;
}

export function VaultWorkspace({
  account,
  provider,
  onConnectWallet,
  onProtocolRefresh,
}: VaultWorkspaceProps) {
  const [registry, setRegistry] = useState<VaultRegistry>();
  const [selectedVault, setSelectedVault] = useState<string>();
  const [vault, setVault] = useState<VaultState>();
  const [action, setAction] = useState<WorkspaceAction>('deposit');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [status, setStatus] = useState<ActionStatus>(IDLE_STATUS);
  const [lastConfirmed, setLastConfirmed] = useState<ActionStatus>();
  const [deposit0, setDeposit0] = useState('1');
  const [deposit1, setDeposit1] = useState('1');
  const [redeemPercent, setRedeemPercent] = useState(100);
  const [lpTokenAdded, setLpTokenAdded] = useState(false);
  const refreshRegistry = useCallback(async () => {
    const params = account ? `?address=${encodeURIComponent(account)}` : '';
    const next = await responseJson<VaultRegistry>(
      await fetch(`${apiBase()}/vaults${params}`),
    );
    setRegistry(next);
    setSelectedVault((current) =>
      current && next.vaults.some((item) => item.toLowerCase() === current.toLowerCase())
        ? current
        : next.vaults.at(-1),
    );
    return next;
  }, [account]);

  const refreshVault = useCallback(
    async (target = selectedVault) => {
      if (!target) {
        setVault(undefined);
        return;
      }
      const params = account ? `?address=${encodeURIComponent(account)}` : '';
      const next = await responseJson<VaultState>(
        await fetch(`${apiBase()}/vaults/${target}${params}`),
      );
      setVault(next);
    },
    [account, selectedVault],
  );

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const next = await refreshRegistry();
      const target =
        selectedVault && next.vaults.includes(selectedVault)
          ? selectedVault
          : next.vaults.at(-1);
      if (target) {
        const params = account ? `?address=${encodeURIComponent(account)}` : '';
        setVault(
          await responseJson<VaultState>(
            await fetch(`${apiBase()}/vaults/${target}${params}`),
          ),
        );
      } else {
        setVault(undefined);
      }
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [account, refreshRegistry, selectedVault]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!selectedVault) return;
    void refreshVault(selectedVault).catch((error) =>
      setLoadError(error instanceof Error ? error.message : String(error)),
    );
  }, [refreshVault, selectedVault]);

  useEffect(() => {
    const refreshAfterFill = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== 'turing-pool:last-vault-fill') {
        return;
      }
      void refreshAll();
    };
    window.addEventListener('storage', refreshAfterFill);
    window.addEventListener('turing-pool:vault-fill', refreshAfterFill);
    return () => {
      window.removeEventListener('storage', refreshAfterFill);
      window.removeEventListener('turing-pool:vault-fill', refreshAfterFill);
    };
  }, [refreshAll]);

  const ownershipPercent = useMemo(
    () => (vault ? Number(vault.position.ownershipPpb) / 10_000_000 : 0),
    [vault],
  );
  const ownershipLabel =
    ownershipPercent > 0 && ownershipPercent < 0.01
      ? `${ownershipPercent.toFixed(6)}%`
      : `${ownershipPercent.toFixed(2)}%`;
  const lpEconomics = useMemo(() => {
    if (!vault || !vault.position.accounting.available) return undefined;
    const reserve0 = unitsAsNumber(vault.reserves.token0, vault.token0.decimals);
    const reserve1 = unitsAsNumber(vault.reserves.token1, vault.token1.decimals);
    const token0Price = reserve0 > 0 ? reserve1 / reserve0 : 0;
    const claim0 = unitsAsNumber(vault.position.claimToken0, vault.token0.decimals);
    const claim1 = unitsAsNumber(vault.position.claimToken1, vault.token1.decimals);
    const contributed0 = unitsAsNumber(
      vault.position.accounting.netContributedToken0,
      vault.token0.decimals,
    );
    const contributed1 = unitsAsNumber(
      vault.position.accounting.netContributedToken1,
      vault.token1.decimals,
    );
    const currentValue = claim0 * token0Price + claim1;
    const contributedValue = contributed0 * token0Price + contributed1;
    const rawPnl = currentValue - contributedValue;
    const pnl = Math.abs(rawPnl) < 0.00005 ? 0 : rawPnl;
    return {
      currentValue,
      contributedValue,
      pnl,
      pnlPercent: contributedValue > 0 ? (pnl / contributedValue) * 100 : undefined,
      token0Price,
    };
  }, [vault]);
  const depositPreview = useMemo(() => {
    if (!vault) return undefined;
    try {
      const maxAmount0 = BigInt(parseUnits(deposit0, vault.token0.decimals));
      const maxAmount1 = BigInt(parseUnits(deposit1, vault.token1.decimals));
      const reserve0 = BigInt(vault.reserves.token0);
      const reserve1 = BigInt(vault.reserves.token1);
      const supply = BigInt(vault.totalSupply);
      let shares: bigint;
      let amount0: bigint;
      let amount1: bigint;

      if (supply === 0n) {
        const grossShares = squareRoot(maxAmount0 * maxAmount1);
        shares = grossShares > MINIMUM_LIQUIDITY
          ? grossShares - MINIMUM_LIQUIDITY
          : 0n;
        amount0 = shares > 0n ? maxAmount0 : 0n;
        amount1 = shares > 0n ? maxAmount1 : 0n;
      } else if (reserve0 > 0n && reserve1 > 0n) {
        const sharesFromToken0 = (maxAmount0 * supply) / reserve0;
        const sharesFromToken1 = (maxAmount1 * supply) / reserve1;
        shares = sharesFromToken0 < sharesFromToken1
          ? sharesFromToken0
          : sharesFromToken1;
        amount0 = shares > 0n ? ceilMulDiv(shares, reserve0, supply) : 0n;
        amount1 = shares > 0n ? ceilMulDiv(shares, reserve1, supply) : 0n;
      } else {
        shares = 0n;
        amount0 = 0n;
        amount1 = 0n;
      }

      return {
        amount0,
        amount1,
        shares,
        unused0: maxAmount0 - amount0,
        unused1: maxAmount1 - amount1,
      };
    } catch {
      return undefined;
    }
  }, [deposit0, deposit1, vault]);
  const actionPending = ['preparing', 'wallet', 'mining'].includes(status.state);

  async function requireWallet(): Promise<{
    account: string;
    provider: Eip1193Provider;
  } | null> {
    if (!account || !provider) {
      await onConnectWallet(false);
      return null;
    }
    await ensureExecutionChain(provider);
    return { account, provider };
  }

  async function submitPrepared(
    endpoint: string,
    body: Record<string, unknown>,
    finalActions: PreparedVaultAction['action'][],
  ) {
    const connected = await requireWallet();
    if (!connected) return;
    setStatus({
      state: 'preparing',
      title: 'Building safe transaction',
      detail: 'Reading the latest Aqua order and simulating against current reserves.',
    });
    setLastConfirmed(undefined);
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const prepared = await responseJson<PreparedVaultAction>(
          await fetch(`${apiBase()}${endpoint}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...body, address: connected.account }),
          }),
        );
        const approval = prepared.action.startsWith('approve-');
        setStatus({
          state: 'wallet',
          title: approval ? 'Approve token in wallet' : 'Confirm action in wallet',
          detail: approval
            ? 'This one-time allowance is scoped to the selected vault or SwapVM router.'
            : 'The simulated transaction is ready to broadcast on the execution network.',
        });
        const transactionHash = await sendWalletTransaction(
          connected.provider,
          prepared.transaction,
        );
        setStatus({
          state: 'mining',
          title: approval ? 'Mining token approval' : 'Mining on-chain action',
          detail: `${transactionHash.slice(0, 12)}… is pending on the execution network.`,
          transactionHash,
        });
        const receipt = await waitForWalletReceipt(connected.provider, transactionHash);
        if (finalActions.includes(prepared.action)) {
          const confirmedStatus: ActionStatus = {
            state: 'confirmed',
            title:
              prepared.action === 'swap'
                ? 'Vault trade settled through Aqua'
                : prepared.action === 'deposit'
                  ? 'Liquidity deposited and LP shares minted'
                  : prepared.action === 'redeem'
                    ? 'LP shares redeemed'
                  : 'Liquidity action confirmed',
            detail: `Confirmed in execution block ${BigInt(receipt.blockNumber)}.`,
            transactionHash,
          };
          setStatus(confirmedStatus);
          setLastConfirmed(confirmedStatus);
          await Promise.all([refreshAll(), onProtocolRefresh()]);
          return;
        }
        await waitForRpcVisibility();
      }
      throw new Error('The required token allowances were not visible after confirmation.');
    } catch (error) {
      setStatus({
        state: 'error',
        title: 'Action not completed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function addLiquidity() {
    if (!vault) return;
    let maxAmount0: string;
    let maxAmount1: string;
    try {
      maxAmount0 = parseUnits(deposit0, vault.token0.decimals);
      maxAmount1 = parseUnits(deposit1, vault.token1.decimals);
    } catch (error) {
      setStatus({
        state: 'error',
        title: 'Invalid deposit amount',
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    await submitPrepared(
      `/vaults/${vault.vault}/liquidity/prepare`,
      { action: 'deposit', maxAmount0, maxAmount1 },
      ['deposit'],
    );
  }

  async function redeemLiquidity() {
    if (!vault) return;
    const shares = (BigInt(vault.position.shares) * BigInt(redeemPercent)) / 100n;
    if (shares === 0n) {
      setStatus({
        state: 'error',
        title: 'No LP shares selected',
        detail: 'Connect an LP wallet or choose a larger redemption percentage.',
      });
      return;
    }
    await submitPrepared(
      `/vaults/${vault.vault}/liquidity/prepare`,
      { action: 'redeem', shares: shares.toString() },
      ['redeem'],
    );
  }

  async function watchLpToken() {
    try {
      if (!provider || !vault) {
        await onConnectWallet(false);
        return;
      }
      await ensureExecutionChain(provider);
      const added = await addTokenToWallet(provider, vault.shareToken);
      setLpTokenAdded(added);
    } catch (error) {
      setStatus({
        state: 'error',
        title: 'LP token was not added',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const explorerUrl = status.transactionHash
    ? transactionExplorer(registry?.chainId ?? 480, status.transactionHash)
    : undefined;
  const lpTokenUrl = vault
    ? addressExplorer(registry?.chainId ?? 480, vault.shareToken.address)
    : undefined;

  return (
    <section className="vault-workspace" id="liquidity">
      <header className="section-head vault-heading">
        <div>
          <span>Permissionless liquidity</span>
          <h2>Pool vaults</h2>
        </div>
        <div className="vault-registry-status">
          <b className={registry?.enabled ? 'online' : undefined}>
            {registry?.enabled ? 'FACTORY LIVE' : 'FACTORY NOT CONFIGURED'}
          </b>
          <small>{registry?.enabled ? `${registry.vaults.length} pool${registry.vaults.length === 1 ? '' : 's'} available` : 'HumanGate v2 required'}</small>
        </div>
      </header>

      {loadError && <div className="vault-banner error">{loadError}</div>}
      {!registry?.enabled ? (
        <div className="vault-empty">
          <strong>The LP interface is ready for a deployment manifest.</strong>
          <p>{registry?.reason ?? 'Reading the configured vault factory…'}</p>
          <small>Set <code>VAULT_FACTORY</code> after deploying the HumanGate v2 router and factory.</small>
        </div>
      ) : (
        <>
          <div className="vault-toolbar">
            <label>
              Active market
              <select
                disabled={loading || registry.vaults.length === 0}
                onChange={(event) => setSelectedVault(event.target.value)}
                value={selectedVault ?? ''}
              >
                {registry.vaults.length === 0 && <option value="">No pools created</option>}
                {registry.vaults.map((address, index) => (
                  <option key={address} value={address}>
                    Pool {index + 1} · {shortAddress(address)}
                  </option>
                ))}
              </select>
            </label>
            <nav aria-label="Vault actions">
              {ACTIONS.map((item) => (
                <button
                  aria-pressed={action === item}
                  className={action === item ? 'active' : undefined}
                  key={item}
                  onClick={() => {
                    setAction(item);
                    setStatus(IDLE_STATUS);
                  }}
                  type="button"
                >
                  {item === 'deposit' ? 'Add liquidity' : item === 'redeem' ? 'Withdraw' : item}
                </button>
              ))}
            </nav>
          </div>

          {!vault ? (
            <div className="vault-empty">
              <strong>No liquidity market is available.</strong>
              <p>The protocol has not configured an active pool for liquidity providers.</p>
            </div>
          ) : (
            <>
              <div className="vault-market-strip">
                <div><span>Market</span><strong>{vault.token0.symbol} / {vault.token1.symbol}</strong><small>Aqua order {vault.strategyActive ? 'active' : 'inactive'}</small></div>
                <div><span>Live fees</span><strong>{vault.feeSchedules.token0.tightFeeBps} / {vault.feeSchedules.token0.wideFeeBps} bps</strong><small>verified retail / searcher · {vault.feeSchedules.token0.targetFeeBps} bps target</small></div>
                <div><span>Pool inventory</span><strong>{formatUnits(vault.reserves.token0, vault.token0.decimals, 4)} {vault.token0.symbol}</strong><small>{formatUnits(vault.reserves.token1, vault.token1.decimals, 4)} {vault.token1.symbol}</small></div>
                <div><span>My position</span><strong>{ownershipLabel}</strong><small>{formatUnits(vault.position.shares, 18, 4)} {vault.shareToken.symbol}</small></div>
              </div>

              {lastConfirmed && (
                <div className="vault-action-success" role="status">
                  <i aria-hidden="true">✓</i>
                  <div>
                    <span>Liquidity action confirmed</span>
                    <strong>{lastConfirmed.title}</strong>
                    <small>{lastConfirmed.detail} Your position and pool balances are now refreshed.</small>
                  </div>
                  {explorerUrl && (
                    <a href={explorerUrl} rel="noreferrer" target="_blank">
                      Open transaction receipt ↗
                    </a>
                  )}
                  <button
                    aria-label="Dismiss confirmation"
                    onClick={() => setLastConfirmed(undefined)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              )}

              <div className={`vault-grid ${status.state === 'idle' || status.state === 'confirmed' ? 'idle' : ''}`}>
                <article className="vault-card vault-action-card">
                  {action === 'deposit' && (
                    <>
                      <span>Add liquidity</span>
                      <h3>Mint {vault.shareToken.symbol}</h3>
                      <p>Set the most you will supply. The live quote below shows the exact two-token ratio the vault can consume.</p>
                      <label className="vault-amount">Maximum {vault.token0.symbol}<input inputMode="decimal" value={deposit0} onChange={(event) => setDeposit0(event.target.value)} /><b>{vault.token0.symbol}</b></label>
                      <label className="vault-amount">Maximum {vault.token1.symbol}<input inputMode="decimal" value={deposit1} onChange={(event) => setDeposit1(event.target.value)} /><b>{vault.token1.symbol}</b></label>
                      <div className={`vault-deposit-preview ${!depositPreview || depositPreview.shares === 0n ? 'invalid' : ''}`}>
                        <header>
                          <span>Live deposit quote</span>
                          <b>Two-sided · current pool ratio</b>
                        </header>
                        {depositPreview && depositPreview.shares > 0n ? (
                          <>
                            <div className="vault-deposit-consumed">
                              <div>
                                <small>Vault will take</small>
                                <strong>{formatUnits(depositPreview.amount0, vault.token0.decimals, 6)} {vault.token0.symbol}</strong>
                              </div>
                              <i>+</i>
                              <div>
                                <small>Vault will take</small>
                                <strong>{formatUnits(depositPreview.amount1, vault.token1.decimals, 6)} {vault.token1.symbol}</strong>
                              </div>
                            </div>
                            <dl>
                              <div>
                                <dt>Estimated LP shares</dt>
                                <dd>{formatUnits(depositPreview.shares, 18, 6)} {vault.shareToken.symbol}</dd>
                              </div>
                              <div>
                                <dt>Unused maximums</dt>
                                <dd>
                                  {formatUnits(depositPreview.unused0, vault.token0.decimals, 6)} {vault.token0.symbol}
                                  {' · '}
                                  {formatUnits(depositPreview.unused1, vault.token1.decimals, 6)} {vault.token1.symbol}
                                </dd>
                              </div>
                            </dl>
                          </>
                        ) : (
                          <p>Enter positive amounts for both assets. This vault does not accept one-sided deposits.</p>
                        )}
                      </div>
                      <div className="vault-balance-row"><span>Wallet</span><b>{formatUnits(vault.position.token0Balance, vault.token0.decimals, 4)} {vault.token0.symbol}</b><b>{formatUnits(vault.position.token1Balance, vault.token1.decimals, 4)} {vault.token1.symbol}</b></div>
                      <button className="vault-primary" disabled={vault.paused || actionPending || !depositPreview || depositPreview.shares === 0n} onClick={() => void addLiquidity()} type="button">
                        {!account ? 'Connect wallet to deposit' : vault.paused ? 'Pool deposits paused' : 'Approve assets & add liquidity'}
                      </button>
                    </>
                  )}

                  {action === 'redeem' && (
                    <>
                      <span>Remove liquidity</span>
                      <h3>Redeem LP shares</h3>
                      <p>Receive the same pro-rata fraction of both live reserves. Withdrawals remain open while paused.</p>
                      <div className="redeem-options">
                        {[25, 50, 75, 100].map((percent) => (
                          <button className={redeemPercent === percent ? 'active' : undefined} key={percent} onClick={() => setRedeemPercent(percent)} type="button">{percent}%</button>
                        ))}
                      </div>
                      <div className="vault-redemption">
                        <span>Shares to burn</span>
                        <strong>{formatUnits((BigInt(vault.position.shares) * BigInt(redeemPercent)) / 100n, 18, 6)} {vault.shareToken.symbol}</strong>
                        <small>≈ {(ownershipPercent * redeemPercent / 100).toFixed(6)}% of pool inventory</small>
                      </div>
                      <button className="vault-primary" disabled={actionPending} onClick={() => void redeemLiquidity()} type="button">
                        {!account ? 'Connect wallet to withdraw' : 'Redeem through wallet'}
                      </button>
                    </>
                  )}
                </article>

                <article className="vault-card vault-position">
                  <span>Connected wallet</span>
                  <h3>My position</h3>
                  {!account && (
                    <div className="vault-position-empty">
                      <strong>Connect a wallet to view its LP position</strong>
                      <p>Ownership, supplied assets, withdrawable balances, and earnings will appear here.</p>
                    </div>
                  )}
                  {account && lpEconomics && (
                    <div className={`vault-pnl ${lpEconomics.pnl >= 0 ? 'positive' : 'negative'}`}>
                      <span>Position P&amp;L</span>
                      <strong>
                        {lpEconomics.pnl > 0 ? '+' : ''}
                        {lpEconomics.pnl.toLocaleString('en-US', { maximumFractionDigits: 4 })}{' '}
                        {vault.token1.symbol}
                      </strong>
                      <small>
                        {lpEconomics.pnlPercent === undefined
                          ? 'No contribution basis yet'
                          : `${lpEconomics.pnlPercent >= 0 ? '+' : ''}${lpEconomics.pnlPercent.toFixed(3)}%`}
                        {' · '}inventory change valued at the current pool price
                      </small>
                      <section
                        aria-labelledby="vault-token-change-label"
                        className="vault-pnl-legs"
                      >
                        <h4 id="vault-token-change-label">Token inventory change</h4>
                        <dl>
                          <div
                            className={BigInt(vault.position.accounting.pnlToken0) > 0n
                              ? 'positive'
                              : BigInt(vault.position.accounting.pnlToken0) < 0n
                                ? 'negative'
                                : 'neutral'}
                          >
                            <dt>{vault.token0.symbol}</dt>
                            <dd>
                              {formatSignedUnits(
                                vault.position.accounting.pnlToken0,
                                vault.token0.decimals,
                                6,
                              )}{' '}
                              {vault.token0.symbol}
                            </dd>
                          </div>
                          <div
                            className={BigInt(vault.position.accounting.pnlToken1) > 0n
                              ? 'positive'
                              : BigInt(vault.position.accounting.pnlToken1) < 0n
                                ? 'negative'
                                : 'neutral'}
                          >
                            <dt>{vault.token1.symbol}</dt>
                            <dd>
                              {formatSignedUnits(
                                vault.position.accounting.pnlToken1,
                                vault.token1.decimals,
                                6,
                              )}{' '}
                              {vault.token1.symbol}
                            </dd>
                          </div>
                        </dl>
                        <small>
                          Compared with assets supplied, net of withdrawals.
                        </small>
                      </section>
                    </div>
                  )}
                  {account && (
                    <>
                      <dl>
                        <div><dt>Position value</dt><dd>{lpEconomics ? `${lpEconomics.currentValue.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${vault.token1.symbol}` : '—'}</dd></div>
                        <div><dt>You supplied</dt><dd>{formatUnits(vault.position.accounting.netContributedToken0, vault.token0.decimals, 5)} {vault.token0.symbol} + {formatUnits(vault.position.accounting.netContributedToken1, vault.token1.decimals, 5)} {vault.token1.symbol}</dd></div>
                        <div><dt>Available to withdraw</dt><dd>{formatUnits(vault.position.claimToken0, vault.token0.decimals, 8)} {vault.token0.symbol} + {formatUnits(vault.position.claimToken1, vault.token1.decimals, 8)} {vault.token1.symbol}</dd></div>
                        <div><dt>Pool ownership</dt><dd>{ownershipLabel}</dd></div>
                        <div><dt>LP tokens</dt><dd>{formatUnits(vault.position.shares, 18, 6)} {vault.shareToken.symbol}</dd></div>
                      </dl>
                      <p className="vault-position-note">
                        LP tokens stay constant between deposits and withdrawals. Each settled swap
                        changes the reserves behind them and refreshes the amount available to withdraw.
                      </p>
                      <details className="vault-position-token">
                        <summary>LP token details</summary>
                        <a href={lpTokenUrl} rel="noreferrer" target="_blank">
                          Contract {shortAddress(vault.shareToken.address)} ↗
                        </a>
                        <button className="vault-token-button" onClick={() => void watchLpToken()} type="button">
                          {lpTokenAdded ? `${vault.shareToken.symbol} added to wallet` : `Add ${vault.shareToken.symbol} to wallet`}
                        </button>
                      </details>
                    </>
                  )}
                </article>

                {!['idle', 'confirmed'].includes(status.state) && (
                  <VaultStatus status={status} explorerUrl={explorerUrl} />
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function VaultStatus({
  status,
  explorerUrl,
}: {
  status: ActionStatus;
  explorerUrl?: string;
}) {
  return (
    <article aria-live="polite" className={`vault-card vault-status ${status.state}`}>
      <span>Execution path</span>
      <h3>{status.title}</h3>
      <p>{status.detail}</p>
      {status.state !== 'idle' && (
        <ol>
          <li className="complete"><i>1</i><span>Factory + vault state</span><b>Turing Swap</b></li>
          <li className={['wallet', 'mining', 'confirmed'].includes(status.state) ? 'complete' : undefined}><i>2</i><span>Wallet approval</span><b>Connected wallet</b></li>
          <li className={status.state === 'confirmed' ? 'complete' : undefined}><i>3</i><span>Aqua order migration / settlement</span><b>1inch</b></li>
          <li className={status.state === 'confirmed' ? 'complete' : undefined}><i>4</i><span>Position + fee state refreshed</span><b>Indexer</b></li>
        </ol>
      )}
      {explorerUrl && <a href={explorerUrl} rel="noreferrer" target="_blank">Open transaction receipt ↗</a>}
    </article>
  );
}
