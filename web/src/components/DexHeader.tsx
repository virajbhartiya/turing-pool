import { shortAddress } from '../lib/format';
import type { ConnectedWalletQuote } from '../types';

export type DexView = 'overview' | 'autopilot' | 'trade' | 'pool' | 'verify' | 'protocol';

interface DexHeaderProps {
  activeView: DexView;
  onViewChange: (view: DexView) => void;
  account?: string;
  accounts: string[];
  quote?: ConnectedWalletQuote;
  connecting: boolean;
  onConnect: (requestAccountSelection?: boolean) => Promise<void>;
  onSelectAccount: (account: string) => void;
  networkLabel?: string;
  connected?: boolean;
}

const NAVIGATION: Array<{ view: DexView; label: string; path: string }> = [
  { view: 'overview', label: 'Overview', path: 'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h6v6h-6z' },
  { view: 'autopilot', label: 'Strategies', path: 'M4 17l5-5 4 3 7-11 M14 4h6v6' },
  { view: 'trade', label: 'Swap', path: 'M4 8h16 M16 4l4 4-4 4 M20 16H4 M8 12l-4 4 4 4' },
  { view: 'pool', label: 'Liquidity', path: 'M12 3c-2 4-7 8-7 12a7 7 0 0014 0c0-4-5-8-7-12z' },
];

function NavIcon({ path }: { path: string }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

export function DexHeader({
  activeView, onViewChange, account, accounts, quote, connecting, onConnect,
  onSelectAccount, networkLabel = 'World Chain', connected = false,
}: DexHeaderProps) {
  return (
    <header className="dex-header">
      <a className="skip-link" href="#workspace-content" onClick={(event) => {
        event.preventDefault();
        const content = document.getElementById('workspace-content');
        content?.focus({ preventScroll: true });
        content?.scrollIntoView({ block: 'start' });
      }}>Skip to content</a>
      <div className="workspace-topbar">
        <a className="workspace-brand" href="#overview" onClick={(event) => { event.preventDefault(); onViewChange('overview'); }} aria-label="Turing overview">
          <span className="turing-symbol" aria-hidden="true"><i /><i /><i /></span><span>turing<span className="brand-period">.</span></span>
        </a>
        <nav className="workspace-navigation" aria-label="Product navigation">
          {NAVIGATION.map((item) => (
            <a key={item.view} href={`#${item.view}`} aria-current={activeView === item.view ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onViewChange(item.view); }}>
              <NavIcon path={item.path} /><span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="workspace-tools">
          <nav className="workspace-utilities" aria-label="Account and history">
            <a href="#protocol" aria-label="Activity" aria-current={activeView === 'protocol' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onViewChange('protocol'); }}><NavIcon path="M3 12a9 9 0 109-9 9 9 0 00-7 3 M3 3v5h5 M12 7v5l3 2" /><span>Activity</span></a>
            <a href="#verify" aria-label="Account" aria-current={activeView === 'verify' ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onViewChange('verify'); }}><NavIcon path="M16 7a4 4 0 11-8 0 4 4 0 018 0 M4 21v-2a8 8 0 0116 0v2" /><span>Account</span></a>
          </nav>
          {!account ? (
            <button className="workspace-wallet" disabled={connecting} onClick={() => void onConnect(false)} type="button"><NavIcon path="M3 6h16v14H3z M3 6l13-3v3 M15 11h6v5h-6z" /><span>{connecting ? 'Connecting…' : 'Connect wallet'}</span></button>
          ) : (
            <div className="workspace-wallet wallet-connected"><span className="wallet-avatar" aria-label={quote?.humanBacked ? 'World ID verified' : 'Wallet connected'}>{quote?.humanBacked ? '✓' : '◈'}</span>{accounts.length > 1 ? <select aria-label="Active wallet" onChange={(event) => onSelectAccount(event.target.value)} value={account}>{accounts.map((candidate) => <option key={candidate} value={candidate}>{shortAddress(candidate)}</option>)}</select> : <button onClick={() => void onConnect(true)} type="button">{shortAddress(account)}</button>}</div>
          )}
        </div>
      </div>
      <div className="workspace-context">
        <span><span className="context-label">WORKSPACE</span><span className="context-divider">/</span>{activeView === 'autopilot' ? 'Strategy studio' : activeView === 'trade' ? 'Swap tokens' : activeView === 'pool' ? 'Liquidity' : activeView === 'verify' ? 'Account & verification' : activeView === 'protocol' ? 'Transaction history' : 'Market overview'}</span>
        <span className="context-network"><i className={connected ? 'online' : ''} />{networkLabel}</span>
      </div>
    </header>
  );
}
