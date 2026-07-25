import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiBase } from '../hooks/useProtocol';
import { responseJson } from '../lib/apiResponse';
import {
  addressExplorer,
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
  VaultQuote,
  VaultRegistry,
  VaultState,
  VaultTradeDirection,
} from '../types';

type WorkspaceAction = 'trade' | 'deposit' | 'redeem' | 'create';

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
  detail: 'Every state-changing action is simulated before MetaMask opens.',
};

const ACTIONS = ['trade', 'deposit', 'redeem', 'create'] as const;

function waitForRpcVisibility(milliseconds = 650): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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
  const [action, setAction] = useState<WorkspaceAction>('trade');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [status, setStatus] = useState<ActionStatus>(IDLE_STATUS);
  const [direction, setDirection] = useState<VaultTradeDirection>('token0-to-token1');
  const [tradeAmount, setTradeAmount] = useState('0.1');
  const [quote, setQuote] = useState<VaultQuote>();
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [deposit0, setDeposit0] = useState('1');
  const [deposit1, setDeposit1] = useState('1');
  const [redeemPercent, setRedeemPercent] = useState(100);
  const [lpTokenAdded, setLpTokenAdded] = useState(false);
  const [createForm, setCreateForm] = useState({
    token0: '',
    token1: '',
    name: 'Turing Pool LP',
    symbol: 'tpLP',
    dailyCap0: '10',
    dailyCap1: '40000',
  });

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
    if (!account || !vault || !vault.strategyActive || action !== 'trade') {
      setQuote(undefined);
      setQuoteError(undefined);
      return;
    }
    const controller = new AbortController();
    let ignore = false;
    const timeout = window.setTimeout(() => {
      let amountIn: string;
      try {
        const tokenIn = direction === 'token0-to-token1' ? vault.token0 : vault.token1;
        amountIn = parseUnits(tradeAmount, tokenIn.decimals);
      } catch (error) {
        setQuote(undefined);
        setQuoteError(error instanceof Error ? error.message : String(error));
        return;
      }
      setQuoteLoading(true);
      const params = new URLSearchParams({ address: account, amountIn, direction });
      void fetch(`${apiBase()}/vaults/${vault.vault}/quote?${params}`, {
        signal: controller.signal,
      })
        .then(responseJson<VaultQuote>)
        .then((next) => {
          if (ignore) return;
          setQuote(next);
          setQuoteError(undefined);
        })
        .catch((error) => {
          if (ignore || (error instanceof DOMException && error.name === 'AbortError')) return;
          setQuote(undefined);
          setQuoteError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (!ignore) setQuoteLoading(false);
        });
    }, 300);
    return () => {
      ignore = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [account, action, direction, tradeAmount, vault]);

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
    const pnl = currentValue - contributedValue;
    return {
      currentValue,
      contributedValue,
      pnl,
      pnlPercent: contributedValue > 0 ? (pnl / contributedValue) * 100 : undefined,
      token0Price,
    };
  }, [vault]);
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
          title: approval ? 'Approve token in MetaMask' : 'Confirm action in MetaMask',
          detail: approval
            ? 'This one-time allowance is scoped to the selected vault or SwapVM router.'
            : 'The simulated transaction is ready to broadcast on Base Sepolia.',
        });
        const transactionHash = await sendWalletTransaction(
          connected.provider,
          prepared.transaction,
        );
        setStatus({
          state: 'mining',
          title: approval ? 'Mining token approval' : 'Mining on-chain action',
          detail: `${transactionHash.slice(0, 12)}… is pending on Base Sepolia.`,
          transactionHash,
        });
        const receipt = await waitForWalletReceipt(connected.provider, transactionHash);
        if (finalActions.includes(prepared.action)) {
          setStatus({
            state: 'confirmed',
            title:
              prepared.action === 'swap'
                ? 'Vault trade settled through Aqua'
                : prepared.action === 'deposit'
                  ? 'Liquidity deposited and LP shares minted'
                  : prepared.action === 'redeem'
                    ? 'LP shares redeemed'
                    : 'New vault created',
            detail: `Confirmed in Base Sepolia block ${BigInt(receipt.blockNumber)}.`,
            transactionHash,
          });
          await Promise.all([refreshAll(), onProtocolRefresh()]);
          if (prepared.action === 'create') {
            const next = await refreshRegistry();
            setSelectedVault(next.vaults.at(-1));
            setAction('deposit');
          }
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

  async function executeTrade() {
    if (!account || !provider) {
      await onConnectWallet(false);
      return;
    }
    if (!vault || !quote) return;
    await submitPrepared(
      `/vaults/${vault.vault}/trade/prepare`,
      {
        amountIn: quote.amountIn,
        direction,
      },
      ['swap'],
    );
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

  async function createVault() {
    await submitPrepared('/vaults/create/prepare', createForm, ['create']);
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
  const inputToken = vault
    ? direction === 'token0-to-token1'
      ? vault.token0
      : vault.token1
    : undefined;
  const outputToken = vault
    ? direction === 'token0-to-token1'
      ? vault.token1
      : vault.token0
    : undefined;
  const lpTokenUrl = vault
    ? addressExplorer(registry?.chainId ?? 84532, vault.shareToken.address)
    : undefined;

  return (
    <section className="vault-workspace" id="liquidity">
      <header className="section-head vault-heading">
        <div>
          <span>Permissionless liquidity</span>
          <h2>Pool vaults</h2>
          <p>Deposit inventory, receive transferable LP shares, and trade the vault’s live opcode-34 Aqua order.</p>
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

          {action === 'create' ? (
            <div className="vault-create-grid">
              <article className="vault-card">
                <span>Create a market</span>
                <h3>New isolated LP vault</h3>
                <p>The connected wallet becomes manager. The pool receives its own quota and adaptive fee controller.</p>
                <div className="vault-form-grid">
                  <label>Token 0 address<input value={createForm.token0} onChange={(event) => setCreateForm((current) => ({ ...current, token0: event.target.value }))} /></label>
                  <label>Token 1 address<input value={createForm.token1} onChange={(event) => setCreateForm((current) => ({ ...current, token1: event.target.value }))} /></label>
                  <label>LP token name<input value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label>LP symbol<input value={createForm.symbol} onChange={(event) => setCreateForm((current) => ({ ...current, symbol: event.target.value }))} /></label>
                  <label>Human daily cap · token 0<input inputMode="decimal" value={createForm.dailyCap0} onChange={(event) => setCreateForm((current) => ({ ...current, dailyCap0: event.target.value }))} /></label>
                  <label>Human daily cap · token 1<input inputMode="decimal" value={createForm.dailyCap1} onChange={(event) => setCreateForm((current) => ({ ...current, dailyCap1: event.target.value }))} /></label>
                </div>
                <button className="vault-primary" disabled={actionPending} onClick={() => void createVault()} type="button">
                  {account ? 'Create vault with MetaMask' : 'Connect MetaMask to create'}
                </button>
              </article>
              <VaultStatus status={status} explorerUrl={explorerUrl} />
            </div>
          ) : !vault ? (
            <div className="vault-empty">
              <strong>No vault markets yet.</strong>
              <p>Create the first pool, then seed both assets to ship its Aqua order.</p>
              <button onClick={() => setAction('create')} type="button">Create first vault</button>
            </div>
          ) : (
            <>
              <div className="vault-market-strip">
                <div><span>Market</span><strong>{vault.token0.symbol} / {vault.token1.symbol}</strong><small>Aqua order {vault.strategyActive ? 'active' : 'inactive'}</small></div>
                <div><span>Live fees</span><strong>{vault.feeSchedules.token0.tightFeeBps} / {vault.feeSchedules.token0.wideFeeBps} bps</strong><small>human / bot · {vault.feeSchedules.token0.targetFeeBps} bps target</small></div>
                <div><span>Pool inventory</span><strong>{formatUnits(vault.reserves.token0, vault.token0.decimals, 4)} {vault.token0.symbol}</strong><small>{formatUnits(vault.reserves.token1, vault.token1.decimals, 4)} {vault.token1.symbol}</small></div>
                <div><span>Your LP position</span><strong>{ownershipLabel}</strong><small>{formatUnits(vault.position.shares, 18, 4)} {vault.shareToken.symbol} · ERC-20 on Base Sepolia</small></div>
              </div>

              <div className="vault-grid">
                <article className="vault-card vault-action-card">
                  {action === 'trade' && (
                    <>
                      <span>Trade selected vault</span>
                      <h3>{inputToken?.symbol} → {outputToken?.symbol}</h3>
                      <div className="vault-direction">
                        <button className={direction === 'token0-to-token1' ? 'active' : undefined} onClick={() => setDirection('token0-to-token1')} type="button">{vault.token0.symbol} → {vault.token1.symbol}</button>
                        <button className={direction === 'token1-to-token0' ? 'active' : undefined} onClick={() => setDirection('token1-to-token0')} type="button">{vault.token1.symbol} → {vault.token0.symbol}</button>
                      </div>
                      <label className="vault-amount">Exact input<input inputMode="decimal" value={tradeAmount} onChange={(event) => setTradeAmount(event.target.value)} /><b>{inputToken?.symbol}</b></label>
                      <div className={`vault-quote ${quote?.tight ? 'human' : 'bot'}`}>
                        <span>{quoteLoading ? 'Quoting on-chain…' : quote ? `${quote.tier.toUpperCase()} · ${quote.feeBps} bps` : 'Connect wallet for identity-priced quote'}</span>
                        <strong>{quote ? formatUnits(quote.amountOut, quote.tokenOut.decimals, 6) : '—'} <small>{outputToken?.symbol}</small></strong>
                        <p>{quote?.humanBacked ? `World mirror humanId ${quote.humanId.slice(0, 12)}…` : quote ? 'World mirror returned humanId 0 · anonymous lane' : quoteError}</p>
                      </div>
                      <button
                        className="vault-primary"
                        disabled={
                          actionPending ||
                          Boolean(account && (quoteLoading || !quote || !quote.sufficientBalance))
                        }
                        onClick={() => void executeTrade()}
                        type="button"
                      >
                        {!account ? 'Connect MetaMask to trade' : quote?.requiresApproval ? `Approve ${inputToken?.symbol} & trade` : 'Trade through Aqua'}
                      </button>
                    </>
                  )}

                  {action === 'deposit' && (
                    <>
                      <span>Add liquidity</span>
                      <h3>Mint {vault.shareToken.symbol}</h3>
                      <p>Enter maximums. The vault consumes only the current pool ratio; excess remains in your wallet.</p>
                      <label className="vault-amount">Maximum {vault.token0.symbol}<input inputMode="decimal" value={deposit0} onChange={(event) => setDeposit0(event.target.value)} /><b>{vault.token0.symbol}</b></label>
                      <label className="vault-amount">Maximum {vault.token1.symbol}<input inputMode="decimal" value={deposit1} onChange={(event) => setDeposit1(event.target.value)} /><b>{vault.token1.symbol}</b></label>
                      <div className="vault-balance-row"><span>Wallet</span><b>{formatUnits(vault.position.token0Balance, vault.token0.decimals, 4)} {vault.token0.symbol}</b><b>{formatUnits(vault.position.token1Balance, vault.token1.decimals, 4)} {vault.token1.symbol}</b></div>
                      <button className="vault-primary" disabled={vault.paused || actionPending} onClick={() => void addLiquidity()} type="button">
                        {!account ? 'Connect MetaMask to deposit' : vault.paused ? 'Pool deposits paused' : 'Approve assets & add liquidity'}
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
                        {!account ? 'Connect LP wallet to withdraw' : 'Redeem through MetaMask'}
                      </button>
                    </>
                  )}
                </article>

                <article className="vault-card vault-position">
                  <span>LP position</span>
                  <h3>{account ? `${vault.shareToken.symbol} earnings` : 'Wallet not connected'}</h3>
                  {account && lpEconomics && (
                    <div className={`vault-pnl ${lpEconomics.pnl >= 0 ? 'positive' : 'negative'}`}>
                      <span>Mark-to-pool P&amp;L</span>
                      <strong>
                        {lpEconomics.pnl >= 0 ? '+' : ''}
                        {lpEconomics.pnl.toLocaleString('en-US', { maximumFractionDigits: 4 })}{' '}
                        {vault.token1.symbol}
                      </strong>
                      <small>
                        {lpEconomics.pnlPercent === undefined
                          ? 'No contribution basis yet'
                          : `${lpEconomics.pnlPercent >= 0 ? '+' : ''}${lpEconomics.pnlPercent.toFixed(3)}%`}
                        {' · '}fees and inventory marked at the current pool price
                      </small>
                    </div>
                  )}
                  <dl>
                    <div><dt>LP shares</dt><dd>{formatUnits(vault.position.shares, 18, 6)} {vault.shareToken.symbol}</dd></div>
                    <div><dt>Pool ownership</dt><dd>{ownershipLabel}</dd></div>
                    <div><dt>Redeemable now</dt><dd>{formatUnits(vault.position.claimToken0, vault.token0.decimals, 5)} {vault.token0.symbol} + {formatUnits(vault.position.claimToken1, vault.token1.decimals, 5)} {vault.token1.symbol}</dd></div>
                    <div><dt>Net contributed</dt><dd>{formatUnits(vault.position.accounting.netContributedToken0, vault.token0.decimals, 5)} {vault.token0.symbol} + {formatUnits(vault.position.accounting.netContributedToken1, vault.token1.decimals, 5)} {vault.token1.symbol}</dd></div>
                    <div><dt>Position value</dt><dd>{lpEconomics ? `${lpEconomics.currentValue.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${vault.token1.symbol}` : '—'}</dd></div>
                    <div><dt>LP token contract</dt><dd>{lpTokenUrl ? <a href={lpTokenUrl} rel="noreferrer" target="_blank">{shortAddress(vault.shareToken.address)} ↗</a> : shortAddress(vault.shareToken.address)}</dd></div>
                    <div><dt>Aqua order</dt><dd>{vault.strategyActive ? 'ACTIVE' : vault.paused ? 'PAUSED' : 'UNSEEDED'}</dd></div>
                  </dl>
                  <button className="vault-token-button" onClick={() => void watchLpToken()} type="button">
                    {lpTokenAdded ? `${vault.shareToken.symbol} added to MetaMask` : `Add ${vault.shareToken.symbol} to MetaMask`}
                  </button>
                  <small>
                    The vault contract mints these transferable shares in <code>deposit()</code>.
                    P&amp;L uses on-chain deposit/withdrawal events and your live redeemable claim.
                  </small>
                </article>

                <VaultStatus status={status} explorerUrl={explorerUrl} />
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
          <li className="complete"><i>1</i><span>Factory + vault state</span><b>Turing Pool</b></li>
          <li className={['wallet', 'mining', 'confirmed'].includes(status.state) ? 'complete' : undefined}><i>2</i><span>Wallet approval</span><b>MetaMask</b></li>
          <li className={status.state === 'confirmed' ? 'complete' : undefined}><i>3</i><span>Aqua order migration / settlement</span><b>1inch</b></li>
          <li className={status.state === 'confirmed' ? 'complete' : undefined}><i>4</i><span>Position + fee state refreshed</span><b>Indexer</b></li>
        </ol>
      )}
      {explorerUrl && <a href={explorerUrl} rel="noreferrer" target="_blank">Open transaction receipt ↗</a>}
    </article>
  );
}
