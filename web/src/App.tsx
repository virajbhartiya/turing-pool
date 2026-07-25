import { useCallback, useEffect, useState } from 'react';

import { DexHeader, type DexView } from './components/DexHeader';
import { IdentityWorkspace } from './components/IdentityWorkspace';
import { LandingPage } from './components/LandingPage';
import { LPEconomicsPanel } from './components/LPEconomicsPanel';
import { MarketHeader } from './components/MarketHeader';
import { ProtocolWorkspace } from './components/ProtocolWorkspace';
import { TradingTerminal } from './components/TradingTerminal';
import { VaultWorkspace } from './components/VaultWorkspace';
import { useInjectedWallet } from './hooks/useInjectedWallet';
import { apiBase, demoTradeAmounts, useProtocol } from './hooks/useProtocol';
import { unitsAsNumber } from './lib/format';
import {
  ensureExecutionChain,
  providerErrorCode,
  sendWalletTransaction,
  waitForWalletReceipt,
} from './lib/wallet';
import type {
  ConnectedWalletQuote,
  DemoTradeDirection,
  DemoTradeError,
  DemoTradeLane,
  DemoTradeProgress,
  DemoTradeResult,
  PreparedWalletTrade,
} from './types';

function LoadingTerminal() {
  return (
    <div className="loading-terminal" role="status">
      <span />
      <strong>Connecting to the Turing Pool market…</strong>
      <small>Reading live strategy, quote, and activity state</small>
    </div>
  );
}

function isDemoTradeError(value: unknown): value is DemoTradeError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DemoTradeError>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.error === 'string' &&
    typeof candidate.retryable === 'boolean' &&
    typeof candidate.status === 'number'
  );
}

function isDemoTradeResult(value: unknown): value is DemoTradeResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<DemoTradeResult>).transactionHash === 'string'
  );
}

function upsertProgress(
  current: DemoTradeProgress[],
  next: DemoTradeProgress,
): DemoTradeProgress[] {
  const existing = current.findIndex((item) => item.stage === next.stage);
  if (existing === -1) return [...current, next];
  return current.map((item, index) => (index === existing ? next : item));
}

function queryTarget(label: string, address?: string): string {
  return address ? `${label} · ${address}` : label;
}

function connectedWalletError(error: unknown): DemoTradeError {
  const code = providerErrorCode(error);
  if (code === 4001) {
    return {
      code: 'wallet_rejected',
      error: 'The wallet request was rejected. No transaction was submitted.',
      retryable: false,
      status: 400,
    };
  }
  if (code === 4902) {
    return {
      code: 'wrong_network',
      error: 'The execution network could not be added to the wallet.',
      retryable: false,
      status: 400,
    };
  }
  const description = error instanceof Error ? error.message : String(error);
  if (/insufficient .* balance/i.test(description)) {
    return {
      code: 'insufficient_balance',
      error: description,
      retryable: false,
      status: 400,
    };
  }
  if (/wallet|provider/i.test(description)) {
    return {
      code: 'wallet_unavailable',
      error: description,
      retryable: false,
      status: 400,
    };
  }
  return {
    code: 'network_error',
    error:
      'The wallet transaction could not be confirmed. Check your wallet and the block explorer before retrying.',
    retryable: true,
    retryAfterSeconds: 5,
    status: 0,
  };
}

export function App() {
  const initialDirection: DemoTradeDirection =
    new URLSearchParams(window.location.search).get('side') === 'buy'
      ? 'tUSD-to-tETH'
      : 'tETH-to-tUSD';
  const [direction, setDirection] = useState<DemoTradeDirection>(initialDirection);
  const [amountIn, setAmountIn] = useState(demoTradeAmounts[initialDirection][0]);
  const { snapshot, error, refreshing, refresh } = useProtocol(amountIn, direction);
  const wallet = useInjectedWallet();
  const [walletQuote, setWalletQuote] = useState<ConnectedWalletQuote>();
  const [walletQuoteLoading, setWalletQuoteLoading] = useState(false);
  const [walletQuoteError, setWalletQuoteError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [tradeLane, setTradeLane] = useState<DemoTradeLane>();
  const [tradeError, setTradeError] = useState<DemoTradeError>();
  const [tradeProgress, setTradeProgress] = useState<DemoTradeProgress[]>([]);
  const [lastTrade, setLastTrade] = useState<DemoTradeResult>();
  const initialView = window.location.hash.replace('#', '') as DexView;
  const [activeView, setActiveView] = useState<DexView>(
    ['overview', 'trade', 'pool', 'verify', 'protocol'].includes(initialView)
      ? initialView
      : 'overview',
  );
  useEffect(() => {
    const selectHashView = () => {
      const view = window.location.hash.replace('#', '') as DexView;
      if (['overview', 'trade', 'pool', 'verify', 'protocol'].includes(view)) setActiveView(view);
    };
    window.addEventListener('hashchange', selectHashView);
    return () => window.removeEventListener('hashchange', selectHashView);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const refreshWalletQuote = useCallback(
    async (signal?: AbortSignal) => {
      if (!wallet.account) {
        setWalletQuote(undefined);
        setWalletQuoteError(undefined);
        return;
      }
      setWalletQuoteLoading(true);
      try {
        const params = new URLSearchParams({
          address: wallet.account,
          amountIn,
          direction,
        });
        const response = await fetch(`${apiBase()}/wallet/quote?${params}`, { signal });
        const body: unknown = await response.json();
        if (!response.ok) {
          throw new Error(
            isDemoTradeError(body)
              ? body.error
              : 'The connected wallet could not be quoted on-chain.',
          );
        }
        setWalletQuote(body as ConnectedWalletQuote);
        setWalletQuoteError(undefined);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setWalletQuote(undefined);
        setWalletQuoteError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setWalletQuoteLoading(false);
      }
    },
    [amountIn, direction, wallet.account],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshWalletQuote(controller.signal);
    return () => controller.abort();
  }, [refreshWalletQuote]);

  async function copyReplayCommand() {
    try {
      await navigator.clipboard.writeText('pnpm market:world');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function selectDirection(nextDirection: DemoTradeDirection) {
    setDirection(nextDirection);
    setAmountIn(demoTradeAmounts[nextDirection][0]);
    const url = new URL(window.location.href);
    url.searchParams.set('side', nextDirection === 'tUSD-to-tETH' ? 'buy' : 'sell');
    window.history.replaceState({}, '', url);
  }

  function selectView(view: DexView) {
    setActiveView(view);
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}#${view}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function executeTrade(
    tradeAmountIn: string,
    tradeDirection: DemoTradeDirection,
  ) {
    const walletAccount = wallet.account;
    const walletProvider = wallet.provider;
    if (!walletAccount || !walletProvider) {
      await wallet.connect();
      return;
    }
    const activeLane: DemoTradeLane = walletQuote?.humanBacked ? 'human' : 'bot';
    const tokenIn =
      tradeDirection === 'tETH-to-tUSD'
        ? snapshot?.state.pool.token0
        : snapshot?.state.pool.token1;
    const agentBook = snapshot?.state.contracts.agentBook;
    const quota = snapshot?.state.contracts.quota;
    const router = snapshot?.state.contracts.router;
    setTradeLane(activeLane);
    setTradeError(undefined);
    setTradeProgress([
      {
        stage: 'wallet',
        status: 'active',
        title: 'Verify connected wallet',
        detail: 'Checking the connected account and execution network',
        queries: [
          {
            kind: 'wallet',
            method: 'eth_chainId + eth_accounts',
            target: 'Connected EIP-1193 wallet',
            result: 'Awaiting connected account and chain',
          },
        ],
      },
    ]);
    let approvalTransactionHash: string | undefined;
    try {
      await ensureExecutionChain(walletProvider);
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'wallet',
          status: 'complete',
          title: 'Wallet connected',
          detail: `${walletAccount.slice(0, 8)}…${walletAccount.slice(-6)} on the execution network`,
          queries: [
            {
              kind: 'wallet',
              method: 'eth_chainId + eth_accounts',
              target: 'Connected EIP-1193 wallet',
              result: `chain ${state.runtime.chainId} · ${walletAccount}`,
            },
          ],
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'identity',
          status: 'active',
          title: 'Resolve identity and prepare quote',
          detail: 'Running the live read bundle used to build this wallet’s executable quote',
          queries: [
            {
              kind: 'read',
              method: `lookupHuman(${walletAccount})`,
              target: queryTarget('Canonical World AgentBook', agentBook),
              result: 'Pending',
            },
            {
              kind: 'read',
              method: `feeSchedule(${tokenIn ?? 'tokenIn'})`,
              target: queryTarget('HumanQuota controller', quota),
              result: 'Pending',
            },
            {
              kind: 'read',
              method: `quote(order, tokenIn, tokenOut, ${tradeAmountIn}, traits)`,
              target: queryTarget('SwapVM Router', router),
              result: 'Pending',
            },
            {
              kind: 'read',
              method: `balanceOf(${walletAccount}) + allowance(wallet, router)`,
              target: queryTarget('Input token', tokenIn),
              result: 'Pending',
            },
          ],
        }),
      );

      const prepare = async (): Promise<PreparedWalletTrade> => {
        const response = await fetch(`${apiBase()}/wallet/prepare`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            address: walletAccount,
            amountIn: tradeAmountIn,
            direction: tradeDirection,
          }),
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          if (isDemoTradeError(body)) throw body;
          throw new Error('The server could not prepare a safe wallet transaction.');
        }
        return body as PreparedWalletTrade;
      };

      let prepared = await prepare();
      const preparedLane: DemoTradeLane = prepared.quote.humanBacked ? 'human' : 'bot';
      setTradeLane(preparedLane);
      setWalletQuote(prepared.quote);
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'identity',
          status: 'complete',
          title: prepared.quote.humanBacked
            ? 'World-verified human resolved'
            : 'HFT / arbitrage wallet resolved',
          detail: prepared.quote.humanBacked
            ? `AgentBook humanId ${prepared.quote.humanId.slice(0, 12)}… · ${prepared.quote.tier.toUpperCase()} lane · ${prepared.quote.feeBps} bps`
            : `AgentBook returned humanId 0 · WIDE lane · ${prepared.quote.feeBps} bps`,
          queries: [
            {
              kind: 'read',
              method: `lookupHuman(${walletAccount})`,
              target: queryTarget('Canonical World AgentBook', agentBook),
              result: `humanId ${prepared.quote.humanId}`,
            },
            {
              kind: 'read',
              method: `feeSchedule(${prepared.quote.tokenIn})`,
              target: queryTarget('HumanQuota controller', quota),
              result: `${prepared.quote.feeSchedule.tightFeeBps} / ${prepared.quote.feeSchedule.wideFeeBps} bps · target ${prepared.quote.feeSchedule.targetFeeBps} bps`,
            },
            ...(prepared.quote.humanBacked
              ? [
                  {
                    kind: 'read' as const,
                    method: `remaining(${prepared.quote.humanId}, ${prepared.quote.tokenIn})`,
                    target: queryTarget('HumanQuota controller', quota),
                    result: 'Quota accepted for this input amount',
                  },
                ]
              : []),
            {
              kind: 'read',
              method: `quote(order, ${prepared.quote.tokenIn}, ${prepared.quote.tokenOut}, ${prepared.quote.amountIn}, traits)`,
              target: queryTarget('SwapVM Router', prepared.quote.router),
              result: `${prepared.quote.amountOut} ${prepared.quote.tokenOutSymbol} base units · ${prepared.quote.tier.toUpperCase()} · ${prepared.quote.feeBps} bps`,
            },
            {
              kind: 'read',
              method: `balanceOf(${walletAccount}) + allowance(wallet, router)`,
              target: queryTarget('Input token', prepared.quote.tokenIn),
              result: `balance ${prepared.quote.balance} · allowance ${prepared.quote.allowance}`,
            },
          ],
        }),
      );

      if (prepared.action === 'approve') {
        setTradeProgress((current) =>
          upsertProgress(current, {
            stage: 'allowance',
            status: 'active',
            title: `Approve ${prepared.quote.tokenInSymbol}`,
            detail: 'Confirm the exact input amount allowance in your wallet',
            queries: [
              {
                kind: 'write',
                method: `approve(${prepared.quote.router}, ${prepared.quote.amountIn})`,
                target: queryTarget(prepared.quote.tokenInSymbol, prepared.transaction.to),
                result: 'Awaiting wallet signature',
                calldata: prepared.transaction.data,
              },
            ],
          }),
        );
        approvalTransactionHash = await sendWalletTransaction(
          walletProvider,
          prepared.transaction,
        );
        await waitForWalletReceipt(walletProvider, approvalTransactionHash);
        setTradeProgress((current) =>
          upsertProgress(current, {
            stage: 'allowance',
            status: 'complete',
            title: 'Token approval mined',
            detail: `${prepared.quote.tokenInSymbol} is now approved for the SwapVM router`,
            transactionHash: approvalTransactionHash,
            queries: [
              {
                kind: 'receipt',
                method: `eth_getTransactionReceipt(${approvalTransactionHash})`,
                target: queryTarget(prepared.quote.tokenInSymbol, prepared.transaction.to),
                result: `Exact ${prepared.quote.amountIn} base-unit allowance confirmed`,
                calldata: prepared.transaction.data,
              },
            ],
          }),
        );
        for (let attempt = 0; attempt < 10; attempt += 1) {
          prepared = await prepare();
          if (prepared.action === 'swap') break;
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
        if (prepared.action !== 'swap') {
          throw new Error('The execution RPC has not observed the mined token approval yet.');
        }
      }

      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'simulation',
          status: 'complete',
          title: 'Simulation passed',
          detail: `Opcode ${snapshot?.state.execution?.opcode ?? 34} is executable against Aqua inventory`,
          queries: [
            {
              kind: 'simulate',
              method: 'eth_call swap(order, tokenIn, tokenOut, amountIn, takerTraits)',
              target: queryTarget('SwapVM Router', prepared.transaction.to),
              result: `No revert · quoted output ${prepared.quote.amountOut} ${prepared.quote.tokenOutSymbol} base units`,
              calldata: prepared.transaction.data,
            },
          ],
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'submission',
          status: 'active',
          title: 'Confirm trade in wallet',
          detail: 'Your wallet will sign and broadcast the prepared SwapVM transaction',
          queries: [
            {
              kind: 'write',
              method: 'swap(order, tokenIn, tokenOut, amountIn, takerTraits)',
              target: queryTarget('SwapVM Router', prepared.transaction.to),
              result: 'Awaiting wallet signature',
              calldata: prepared.transaction.data,
            },
          ],
        }),
      );
      const transactionHash = await sendWalletTransaction(
        walletProvider,
        prepared.transaction,
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'submission',
          status: 'complete',
          title: 'Transaction broadcast',
          detail: `${transactionHash.slice(0, 12)}… is pending on the execution network`,
          transactionHash,
          queries: [
            {
              kind: 'write',
              method: 'eth_sendTransaction · swap(order, tokenIn, tokenOut, amountIn, takerTraits)',
              target: queryTarget('SwapVM Router', prepared.transaction.to),
              result: transactionHash,
              calldata: prepared.transaction.data,
            },
          ],
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'settlement',
          status: 'active',
          title: 'Await Aqua settlement',
          detail: 'Waiting for maker inventory movement and the SwapVM receipt',
          transactionHash,
          queries: [
            {
              kind: 'receipt',
              method: `eth_getTransactionReceipt(${transactionHash})`,
              target: 'Execution RPC',
              result: 'Polling until the transaction is mined',
            },
          ],
        }),
      );
      const receipt = await waitForWalletReceipt(walletProvider, transactionHash);
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'settlement',
          status: 'complete',
          title: 'Aqua settlement mined',
          detail: `Execution block ${BigInt(receipt.blockNumber)} confirmed the trade`,
          transactionHash,
          queries: [
            {
              kind: 'receipt',
              method: `eth_getTransactionReceipt(${transactionHash})`,
              target: 'Execution RPC',
              result: `status 0x1 · block ${BigInt(receipt.blockNumber)}`,
            },
          ],
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'receipt',
          status: 'active',
          title: 'Verify on-chain receipt',
          detail: 'Decoding HumanGated and Swapped events against the connected wallet',
          transactionHash,
          queries: [
            {
              kind: 'receipt',
              method: 'decodeEventLog(HumanGated) + decodeEventLog(Swapped)',
              target: queryTarget('SwapVM Router', prepared.transaction.to),
              result: 'Matching taker, token path, fee, and settled amounts',
            },
          ],
        }),
      );
      const confirmationResponse = await fetch(`${apiBase()}/wallet/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: walletAccount,
          transactionHash,
          approvalTransactionHash,
          direction: tradeDirection,
        }),
      });
      const confirmationBody: unknown = await confirmationResponse.json();
      if (!confirmationResponse.ok || !isDemoTradeResult(confirmationBody)) {
        if (isDemoTradeError(confirmationBody)) throw confirmationBody;
        throw new Error('The mined transaction could not be verified by the trade service.');
      }
      setLastTrade(confirmationBody);
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'receipt',
          status: 'complete',
          title: 'Receipt independently verified',
          detail: `HumanGated + Swapped prove ${confirmationBody.tier.toUpperCase()} execution at ${confirmationBody.feeBps} bps`,
          transactionHash,
          queries: [
            {
              kind: 'receipt',
              method: 'decodeEventLog(HumanGated) + decodeEventLog(Swapped)',
              target: queryTarget('SwapVM Router', prepared.transaction.to),
              result: `humanId ${confirmationBody.humanId} · ${confirmationBody.tier.toUpperCase()} · ${confirmationBody.amountIn} → ${confirmationBody.amountOut} · ${confirmationBody.feeBps} bps`,
            },
          ],
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'repricing',
          status: 'active',
          title: 'Reprice the next market',
          detail: 'Reading the post-trade volume-weighted fee controller',
          transactionHash,
          queries: [
            {
              kind: 'read',
              method: `feeSchedule(${confirmationBody.tokenIn})`,
              target: queryTarget('HumanQuota controller', quota),
              result: 'Reading realized lane volumes and next fee pair',
            },
          ],
        }),
      );
      await Promise.all([refresh(), refreshWalletQuote()]);
      window.localStorage.setItem(
        'turing-pool:last-vault-fill',
        JSON.stringify({ transactionHash, confirmedAt: Date.now() }),
      );
      window.dispatchEvent(new Event('turing-pool:vault-fill'));
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'repricing',
          status: 'complete',
          title: 'Next fee pair is live',
          detail: 'Executed volume has repriced the next retail and HFT / arbitrage quotes',
          transactionHash,
          queries: [
            {
              kind: 'read',
              method: `feeSchedule(${confirmationBody.tokenIn})`,
              target: queryTarget('HumanQuota controller', quota),
              result: `${confirmationBody.quotedFeeSchedule.tightFeeBps} / ${confirmationBody.quotedFeeSchedule.wideFeeBps} bps · target ${confirmationBody.quotedFeeSchedule.targetFeeBps} bps · human share ${confirmationBody.quotedFeeSchedule.humanShareBps} bps`,
            },
          ],
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'refresh',
          status: 'complete',
          title: 'Terminal synchronized',
          detail: 'Nuthatch, receipts, LP revenue, and executable rates are refreshed',
          transactionHash,
          queries: [
            {
              kind: 'index',
              method: 'GET /state + /market/quotes + /wallet/quote',
              target: 'Turing API · Nuthatch-backed activity state',
              result: `Receipt ${transactionHash.slice(0, 12)}… merged into current terminal state`,
            },
          ],
        }),
      );
    } catch (caught) {
      const safeError = isDemoTradeError(caught)
        ? caught
        : connectedWalletError(caught);
      setTradeError(safeError);
      setTradeProgress((current) =>
        current.map((item) =>
          item.status === 'active' ? { ...item, status: 'error' } : item,
        ),
      );
    } finally {
      setTradeLane(undefined);
    }
  }

  if (!snapshot) {
    return (
      <main className="app-shell">
        {error && <div className="error-banner">Connection error · {error}</div>}
        <LoadingTerminal />
      </main>
    );
  }

  const { state, quotes } = snapshot;
  const isSnapshot = state.runtime.mode === 'hosted-preview';
  const humanAmountIn = unitsAsNumber(quotes.human.amountIn);
  const humanAmountOut = unitsAsNumber(quotes.human.amountOut);
  const token0PriceInToken1 =
    direction === 'tETH-to-tUSD'
      ? humanAmountOut / humanAmountIn
      : humanAmountIn / humanAmountOut;

  return (
    <main className="app-shell">
      {error && <div className="error-banner">Last refresh failed · {error}</div>}
      <DexHeader
        account={wallet.account}
        accounts={wallet.accounts}
        activeView={activeView}
        connecting={wallet.connecting}
        onConnect={wallet.connect}
        onSelectAccount={wallet.selectAccount}
        onViewChange={selectView}
        quote={walletQuote}
      />

      {activeView === 'overview' && (
        <LandingPage state={state} onNavigate={selectView} />
      )}

      {activeView === 'trade' && (
        <>
          <MarketHeader
            quotes={quotes}
          />
          <TradingTerminal
            state={state}
            quotes={quotes}
            onReplay={copyReplayCommand}
            onTrade={executeTrade}
            walletInstalled={wallet.installed}
            walletConnecting={wallet.connecting}
            connectedAccount={wallet.account}
            connectedChainId={wallet.chainId}
            walletQuote={walletQuote}
            walletQuoteLoading={walletQuoteLoading}
            walletQuoteError={walletQuoteError ?? wallet.error}
            onConnectWallet={wallet.connect}
            tradeError={tradeError}
            tradeLane={tradeLane}
            tradeProgress={tradeProgress}
            lastTrade={lastTrade}
            amountIn={amountIn}
            onAmountChange={setAmountIn}
            direction={direction}
            onDirectionChange={selectDirection}
            onOpenVerify={() => selectView('verify')}
          />
        </>
      )}

      {activeView === 'pool' && (
        <section className="view-workspace">
          <VaultWorkspace
            account={wallet.account}
            provider={wallet.provider}
            onConnectWallet={wallet.connect}
            onProtocolRefresh={refresh}
          />
          <LPEconomicsPanel
            state={state}
            token0PriceInToken1={token0PriceInToken1}
          />
        </section>
      )}

      {activeView === 'verify' && (
        <IdentityWorkspace
          account={wallet.account}
          provider={wallet.provider}
          onConnectWallet={wallet.connect}
          onIdentityReady={async () => {
            await Promise.all([refresh(), refreshWalletQuote()]);
          }}
          quote={walletQuote}
          walletConnecting={wallet.connecting}
          walletInstalled={wallet.installed}
        />
      )}

      {activeView === 'protocol' && (
        <section className="view-workspace protocol-workspace">
          <ProtocolWorkspace state={state} lastTrade={lastTrade} />
        </section>
      )}

      <footer>
        <span>Turing Pool · ETHGlobal Lisbon</span>
        {isSnapshot && <p>Hosted deterministic preview</p>}
      </footer>
    </main>
  );
}
