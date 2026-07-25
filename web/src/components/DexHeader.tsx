import { shortAddress } from '../lib/format';
import type { ConnectedWalletQuote, ProtocolState } from '../types';

export type DexView = 'trade' | 'pool' | 'verify' | 'protocol';

interface DexHeaderProps {
  state: ProtocolState;
  activeView: DexView;
  onViewChange: (view: DexView) => void;
  account?: string;
  accounts: string[];
  quote?: ConnectedWalletQuote;
  connecting: boolean;
  refreshing: boolean;
  onConnect: (requestAccountSelection?: boolean) => Promise<void>;
  onSelectAccount: (account: string) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const NAVIGATION: Array<{ view: DexView; label: string; key: string }> = [
  { view: 'trade', label: 'Trade', key: 'F1' },
  { view: 'pool', label: 'Pool', key: 'F2' },
  { view: 'verify', label: 'Verify', key: 'F3' },
  { view: 'protocol', label: 'Protocol', key: 'F4' },
];

export function DexHeader({
  state,
  activeView,
  onViewChange,
  account,
  accounts,
  quote,
  connecting,
  refreshing,
  onConnect,
  onSelectAccount,
  theme,
  onToggleTheme,
}: DexHeaderProps) {
  const human = quote?.humanBacked === true;
  return (
    <header className="dex-header">
      <div className="dex-statusbar">
        <span className="dex-symbol">TP</span>
        <div className="dex-network">
          <i className={refreshing ? 'refreshing' : undefined} />
          <strong>Base Sepolia</strong>
          <span>Block {state.runtime.latestBlock}</span>
        </div>
        <div className="dex-header-actions">
          <button
            aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="theme-toggle"
            onClick={onToggleTheme}
            type="button"
          >
            {theme === 'dark' ? '☼' : '☾'}
          </button>
          {!account ? (
            <button
              className="header-wallet disconnected"
              disabled={connecting}
              onClick={() => void onConnect(false)}
              type="button"
            >
              {connecting ? 'Opening MetaMask…' : 'Connect wallet'}
            </button>
          ) : (
            <div className={`header-wallet ${human ? 'human' : 'bot'}`}>
              <span>
                <i />
                {human ? 'Verified' : 'Anonymous'}
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
              {quote && <b>{quote.feeBps} bps</b>}
            </div>
          )}
        </div>
      </div>

      <div className="dex-navbar">
        <button
          className="dex-brand"
          onClick={() => onViewChange('trade')}
          type="button"
        >
          <span>T</span>
          <strong>Turing Pool</strong>
          <small>Identity-priced DEX</small>
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
              <kbd>{item.key}</kbd>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="dex-live">
          <i />
          Live contracts
          <span>OP #34</span>
        </div>
      </div>
    </header>
  );
}
