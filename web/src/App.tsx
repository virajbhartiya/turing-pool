import { useCallback, useEffect, useState } from 'react';

import { EvidenceLedger } from './components/EvidenceLedger';
import { FeeControllerPanel } from './components/FeeControllerPanel';
import { IntegrationFlow } from './components/IntegrationFlow';
import { LPEconomicsPanel } from './components/LPEconomicsPanel';
import { MarketHeader } from './components/MarketHeader';
import { ProtocolDetails } from './components/ProtocolDetails';
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

function connectedWalletError(error: unknown): DemoTradeError {
  const code = providerErrorCode(error);
  if (code === 4001) {
    return {
      code: 'wallet_rejected',
      error: 'The MetaMask request was rejected. No transaction was submitted.',
      retryable: false,
      status: 400,
    };
  }
  if (code === 4902) {
    return {
      code: 'wrong_network',
      error: 'Base Sepolia could not be added to MetaMask.',
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
  if (/MetaMask|wallet/i.test(description)) {
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
      'The wallet transaction could not be confirmed. Check MetaMask and BaseScan before retrying.',
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
      await navigator.clipboard.writeText('pnpm demo:world');
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
    setTradeLane(activeLane);
    setTradeError(undefined);
    setTradeProgress([
      {
        stage: 'wallet',
        status: 'active',
        title: 'Verify connected wallet',
        detail: 'Checking MetaMask account and Base Sepolia network',
      },
    ]);
    let approvalTransactionHash: string | undefined;
    try {
      await ensureExecutionChain(walletProvider);
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'wallet',
          status: 'complete',
          title: 'MetaMask wallet connected',
          detail: `${walletAccount.slice(0, 8)}…${walletAccount.slice(-6)} on Base Sepolia`,
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'identity',
          status: 'active',
          title: 'Resolve identity and prepare quote',
          detail: 'Reading the World AgentBook mirror, HumanQuota, and live Base SwapVM state',
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
            : 'Anonymous wallet resolved',
          detail: prepared.quote.humanBacked
            ? `AgentBook humanId ${prepared.quote.humanId.slice(0, 12)}… · ${prepared.quote.tier.toUpperCase()} lane · ${prepared.quote.feeBps} bps`
            : `AgentBook returned humanId 0 · WIDE lane · ${prepared.quote.feeBps} bps`,
        }),
      );

      if (prepared.action === 'approve') {
        setTradeProgress((current) =>
          upsertProgress(current, {
            stage: 'allowance',
            status: 'active',
            title: `Approve ${prepared.quote.tokenInSymbol}`,
            detail: 'Confirm the one-time SwapVM token allowance in MetaMask',
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
          }),
        );
        for (let attempt = 0; attempt < 10; attempt += 1) {
          prepared = await prepare();
          if (prepared.action === 'swap') break;
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
        if (prepared.action !== 'swap') {
          throw new Error('The Base Sepolia RPC has not observed the mined token approval yet.');
        }
      }

      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'simulation',
          status: 'complete',
          title: 'Simulation passed',
          detail: `Opcode ${snapshot?.state.execution?.opcode ?? 34} is executable against Aqua inventory`,
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'submission',
          status: 'active',
          title: 'Confirm trade in MetaMask',
          detail: 'MetaMask will sign and broadcast the prepared SwapVM transaction',
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
          detail: `${transactionHash.slice(0, 12)}… is pending on Base Sepolia`,
          transactionHash,
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'settlement',
          status: 'active',
          title: 'Await Aqua settlement',
          detail: 'Waiting for maker inventory movement and the SwapVM receipt',
          transactionHash,
        }),
      );
      const receipt = await waitForWalletReceipt(walletProvider, transactionHash);
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'settlement',
          status: 'complete',
          title: 'Aqua settlement mined',
          detail: `Base Sepolia block ${BigInt(receipt.blockNumber)} confirmed the trade`,
          transactionHash,
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'receipt',
          status: 'active',
          title: 'Verify on-chain receipt',
          detail: 'Decoding HumanGated and Swapped events against the connected wallet',
          transactionHash,
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
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'repricing',
          status: 'active',
          title: 'Reprice the next market',
          detail: 'Reading the post-trade volume-weighted fee controller',
          transactionHash,
        }),
      );
      await Promise.all([refresh(), refreshWalletQuote()]);
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'repricing',
          status: 'complete',
          title: 'Next fee pair is live',
          detail: 'Executed volume has repriced the next human and bot quotes',
          transactionHash,
        }),
      );
      setTradeProgress((current) =>
        upsertProgress(current, {
          stage: 'refresh',
          status: 'complete',
          title: 'Terminal synchronized',
          detail: 'Nuthatch, receipts, LP revenue, and executable rates are refreshed',
          transactionHash,
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
      <MarketHeader state={state} quotes={quotes} refreshing={refreshing} />
      <TradingTerminal
        state={state}
        quotes={quotes}
        onReplay={copyReplayCommand}
        onTrade={executeTrade}
        walletInstalled={wallet.installed}
        walletConnecting={wallet.connecting}
        connectedAccount={wallet.account}
        connectedAccounts={wallet.accounts}
        connectedChainId={wallet.chainId}
        walletQuote={walletQuote}
        walletQuoteLoading={walletQuoteLoading}
        walletQuoteError={walletQuoteError ?? wallet.error}
        onConnectWallet={wallet.connect}
        onSelectWalletAccount={wallet.selectAccount}
        onIdentityReady={async () => {
          await Promise.all([refresh(), refreshWalletQuote()]);
        }}
        tradeError={tradeError}
        tradeLane={tradeLane}
        tradeProgress={tradeProgress}
        lastTrade={lastTrade}
        amountIn={amountIn}
        onAmountChange={setAmountIn}
        direction={direction}
        onDirectionChange={selectDirection}
      >
        <LPEconomicsPanel
          state={state}
          token0PriceInToken1={token0PriceInToken1}
          activeFeeSchedule={quotes.feeSchedule}
          activeTokenInSymbol={quotes.tokenInSymbol}
        />
      </TradingTerminal>
      <VaultWorkspace
        account={wallet.account}
        provider={wallet.provider}
        onConnectWallet={wallet.connect}
        onProtocolRefresh={refresh}
      />
      <IntegrationFlow state={state} lastTrade={lastTrade} />
      <FeeControllerPanel controller={state.feeController} copied={copied} onReplay={copyReplayCommand} />
      <EvidenceLedger state={state} />
      <ProtocolDetails state={state} />
      <footer>
        <span>Turing Pool · ETHGlobal Lisbon</span>
        <p>
          {isSnapshot
            ? 'Hosted deterministic preview · no live RPC or executable liquidity'
            : `${state.runtime.label} · Aqua + SwapVM settlement · maker-owned demo assets`}
        </p>
      </footer>
    </main>
  );
}
