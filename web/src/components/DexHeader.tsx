import { shortAddress } from '../lib/format';
import type { ConnectedWalletQuote } from '../types';

export type DexView = 'overview' | 'trade' | 'pool' | 'verify' | 'protocol';

interface DexHeaderProps {
  activeView: DexView;
  onViewChange: (view: DexView) => void;
  account?: string;
  accounts: string[];
  quote?: ConnectedWalletQuote;
  connecting: boolean;
  onConnect: (requestAccountSelection?: boolean) => Promise<void>;
  onSelectAccount: (account: string) => void;
}

const NAVIGATION: Array<{ view: DexView; label: string }> = [
  { view: 'overview', label: 'Overview' },
  { view: 'trade', label: 'Swap' },
  { view: 'pool', label: 'Pool' },
  { view: 'verify', label: 'Verify' },
  { view: 'protocol', label: 'Protocol' },
];

export function DexHeader({
  activeView,
  onViewChange,
  account,
  accounts,
  quote,
  connecting,
  onConnect,
  onSelectAccount,
}: DexHeaderProps) {
  const human = quote?.humanBacked === true;
  return (
    <header className="dex-header">
      <div className="dex-navbar">
        <button
          className="dex-brand"
          onClick={() => onViewChange('overview')}
          type="button"
        >
          <span>T</span>
          <strong>Turing Pool</strong>
        </button>
        <nav aria-label="Product navigation">
          {NAVIGATION.map((item) => (
            <button
              aria-current={activeView === item.view ? 'page' : undefined}
              className={activeView === item.view ? 'active' : undefined}
              key={item.view}
              onClick={() => onViewChange(item.view)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="dex-header-actions">
          <a
            className="dex-source-link"
            href="https://github.com/virajbhartiya/turing-pool"
            rel="noreferrer"
            target="_blank"
          >
            GitHub ↗
          </a>
          {!account ? (
            <button
              className="header-wallet disconnected"
              disabled={connecting}
              onClick={() => void onConnect(false)}
              type="button"
            >
              {connecting ? 'Opening wallet…' : 'Connect wallet'}
            </button>
          ) : (
            <div className={`header-wallet ${human ? 'human' : 'bot'}`}>
              <span>
                <i />
                {human ? 'Human-backed' : 'Searcher / HFT'}
              </span>
              {accounts.length > 1 ? (
                <select
                  aria-label="Active wallet"
                  onChange={(event) => onSelectAccount(event.target.value)}
                  value={account}
                >
                  {accounts.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {shortAddress(candidate)}
                    </option>
                  ))}
                </select>
              ) : (
                <button onClick={() => void onConnect(true)} type="button">
                  {shortAddress(account)}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
