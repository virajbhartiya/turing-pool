import type { ConnectedWalletQuote } from '../types';
import type { Eip1193Provider } from '../lib/wallet';
import { BrandLogo } from './BrandLogo';
import { TokenFaucet } from './TokenFaucet';
import { WorldIdentityControl } from './WorldIdentityControl';

interface IdentityWorkspaceProps {
  account?: string;
  provider?: Eip1193Provider;
  quote?: ConnectedWalletQuote;
  walletInstalled: boolean;
  walletConnecting: boolean;
  onConnectWallet: (requestAccountSelection?: boolean) => Promise<void>;
  onIdentityReady: () => Promise<void>;
}

export function IdentityWorkspace({
  account,
  provider,
  quote,
  walletInstalled,
  walletConnecting,
  onConnectWallet,
  onIdentityReady,
}: IdentityWorkspaceProps) {
  const worldVerified = quote?.humanBacked === true;

  return (
    <section className="identity-workspace view-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Your wallet</span>
          <h1>Account & verification</h1>
          <p>
            Connect your wallet, verify with World ID, and get test tokens.
          </p>
        </div>
      </div>

      <div className="identity-layout simplified">
        <article className="identity-action-panel">
          <header>
            <span className="account-icon" aria-hidden="true">◈</span>
            <div>
              <strong>{account ? 'Your trading identity' : 'Connect your wallet'}</strong>
              <small>World ID unlocks verified rates and conditional strategies.</small>
            </div>
          </header>
          {!account ? (
            <>
            <button
              className="identity-connect-button"
              disabled={!walletInstalled || walletConnecting}
              onClick={() => void onConnectWallet(false)}
              type="button"
            >
              {walletConnecting
                ? 'Opening wallet…'
                : walletInstalled
                  ? 'Connect wallet'
                  : 'Install a browser wallet'}
            </button>
            {!walletInstalled && <p className="wallet-setup-help">Open this workspace in a browser with an Ethereum wallet extension enabled, then refresh to connect. Your wallet approves every transaction.</p>}
            </>
          ) : (
            <WorldIdentityControl
              account={account}
              quotedAsHuman={worldVerified}
              onIdentityReady={onIdentityReady}
            />
          )}
        </article>

        <details className="identity-flow-disclosure">
          <summary>
            <span>How verification works</span>
            <b>Learn more</b>
          </summary>
          <aside className="identity-explainer">
            <div>
              <span>02 · World Chain</span>
              <BrandLogo brand="world" />
              <strong>AgentBook registers a humanId</strong>
              <p>World App proves personhood and links the nullifier-derived identity to this wallet.</p>
            </div>
            <i>→</i>
            <div>
              <span>03 · World Chain</span>
              <b className="opcode-logo">34</b>
              <strong>SwapVM reads AgentBook directly</strong>
              <p>The instruction receives only the wallet’s pseudonymous humanId—never the World proof.</p>
            </div>
            <i>→</i>
            <div>
              <span>04 · Aqua settlement</span>
              <BrandLogo brand="oneinch" />
              <strong>Opcode 34 selects the rate</strong>
              <p>World ID-verified retail receives a bounded risk lane; searchers receive variable activity-priced execution.</p>
            </div>
          </aside>
        </details>
      </div>

      <TokenFaucet
        account={account}
        provider={provider}
        walletConnecting={walletConnecting}
        walletInstalled={walletInstalled}
        onConnectWallet={onConnectWallet}
        onClaimed={onIdentityReady}
      />
    </section>
  );
}
