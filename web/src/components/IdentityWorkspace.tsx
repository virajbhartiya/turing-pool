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
  const mirrored = quote?.humanBacked === true;

  return (
    <section className="identity-workspace view-workspace">
      <div className="view-heading compact">
        <div>
          <span>World · verified trading wallets</span>
          <h1>Bind an agent wallet to one unique human.</h1>
          <p>
            Establish accountable agency once, then let SwapVM enforce a shared risk
            budget without exposing proof or biometric data to the DEX.
          </p>
        </div>
      </div>

      <div className="identity-layout simplified">
        <article className="identity-action-panel">
          <header>
            <span>01</span>
            <div>
              <strong>Connect the trading wallet</strong>
              <small>The proof is bound to the exact wallet that will submit trades.</small>
            </div>
          </header>
          {!account ? (
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
          ) : (
            <WorldIdentityControl
              account={account}
              quotedAsHuman={mirrored}
              onIdentityReady={onIdentityReady}
            />
          )}
        </article>

        <details className="identity-flow-disclosure">
          <summary>
            <span>How verification reaches SwapVM</span>
            <b>View flow +</b>
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
              <span>03 · Execution network</span>
              <b className="mirror-logo">↔</b>
              <strong>The identity mirror updates</strong>
              <p>The relayer copies the canonical humanId and source block—never the World proof.</p>
            </div>
            <i>→</i>
            <div>
              <span>04 · SwapVM</span>
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
