import { formatUnits } from '../lib/format';
import type { ProtocolState } from '../types';
import type { DexView } from './DexHeader';
import { BrandLogo } from './BrandLogo';

interface LandingPageProps {
  state: ProtocolState;
  onNavigate: (view: DexView) => void;
}

export function LandingPage({ state, onNavigate }: LandingPageProps) {
  const controller = state.feeController;
  const humanShare = controller.humanShareBps / 10_000;
  const botShare = 1 - humanShare;
  const feeSpread = controller.wideFeeBps - controller.tightFeeBps;

  return (
    <section className="landing">
      <div className="landing-hero">
        <div>
          <span className="eyebrow">Identity-priced liquidity</span>
          <h1>
            Better prices for humans.
            <br />
            The same target yield for LPs.
          </h1>
          <p>
            Turing Pool uses World ID as an on-chain risk signal. Verified retail flow
            receives the tighter rate, while HFT and arbitrage flow gets always-on
            execution at a variable risk price. Both rates move with executed volume.
          </p>
          <div className="landing-actions">
            <button onClick={() => onNavigate('trade')} type="button">Open live market</button>
            <button className="secondary" onClick={() => onNavigate('pool')} type="button">Provide liquidity</button>
          </div>
        </div>
        <div className="landing-market">
          <span>Live adaptive fee schedule</span>
          <div><small>Verified</small><strong>{controller.tightFeeBps}<em>bps</em></strong></div>
          <div><small>HFT / arbitrage</small><strong>{controller.wideFeeBps}<em>bps</em></strong></div>
          <div className="target"><small>LP target</small><strong>{controller.targetFeeBps}<em>bps</em></strong></div>
        </div>
      </div>

      <div className="landing-math">
        <div className="landing-section-copy">
          <span className="eyebrow">The math</span>
          <h2>One volume-weighted constraint</h2>
          <p>
            Rates are priced from traded notional, not wallet count. After every mined
            fill, the controller solves the next pair around the LP’s target.
          </p>
        </div>
        <div className="math-card">
          <div className="math-formula">
            <span><i>h</i> × <b>f<sub>human</sub></b></span>
            <em>+</em>
            <span><i>(1 − h)</i> × <b>f<sub>bot</sub></b></span>
            <em>=</em>
            <span className="result"><b>f<sub>LP target</sub></b></span>
          </div>
          <div className="math-live">
            <span>{(humanShare * 100).toFixed(0)}% × {controller.tightFeeBps}</span>
            <em>+</em>
            <span>{(botShare * 100).toFixed(0)}% × {controller.wideFeeBps}</span>
            <em>=</em>
            <strong>{controller.projectedWeightedFeeBps.toFixed(1)} bps</strong>
          </div>
          <div className="math-solve">
            <div>
              <span>Retail fee</span>
              <code>
                {controller.targetFeeBps} − {(botShare * 100).toFixed(0)}% × {feeSpread}
                {' = '}<b>{controller.tightFeeBps} bps</b>
              </code>
            </div>
            <div>
              <span>HFT / arb fee</span>
              <code>
                {controller.targetFeeBps} + {(humanShare * 100).toFixed(0)}% × {feeSpread}
                {' = '}<b>{controller.wideFeeBps} bps</b>
              </code>
            </div>
          </div>
          <small>
            h = verified volume ÷ total volume · {formatUnits(controller.tightVolume)} tETH
            verified / {formatUnits(controller.wideVolume)} tETH HFT + arbitrage
          </small>
          <dl className="math-definitions">
            <div><dt>Input</dt><dd>Realized trade volume by lane</dd></div>
            <div><dt>Constraint</dt><dd>Weighted fee stays at the LP target</dd></div>
            <div><dt>Output</dt><dd>The next retail and searcher fee pair</dd></div>
          </dl>
          <p className="math-incentive">
            More searcher volume lowers both next rates; more verified volume raises
            both. The searcher lane stays executable and adaptive, retail keeps the
            identity discount, and LPs retain the same blended target.
          </p>
        </div>
      </div>

      <div className="landing-flow">
        <div className="landing-section-copy">
          <span className="eyebrow">One fill, four events</span>
          <h2>From identity to indexed proof</h2>
        </div>
        <div className="event-flow">
          <article>
            <span>01</span>
            <BrandLogo brand="world" />
            <strong>Wallet requests a quote</strong>
            <p>The router reads the Base mirror of World AgentBook. A non-zero humanId enters verified retail; zero enters the HFT / arbitrage lane.</p>
          </article>
          <i>→</i>
          <article>
            <span>02</span>
            <BrandLogo brand="oneinch" />
            <strong>Opcode 34 prices risk</strong>
            <p>HumanGate applies the current lane fee and checks the per-human quota before the wallet can execute.</p>
          </article>
          <i>→</i>
          <article>
            <span>03</span>
            <BrandLogo brand="oneinch" />
            <strong>Aqua settles the fill</strong>
            <p>SwapVM moves the real tokens against the vault’s live Aqua inventory and emits the settlement receipt.</p>
          </article>
          <i>→</i>
          <article>
            <span>04</span>
            <BrandLogo brand="nuthatch" />
            <strong>Volume reprices the market</strong>
            <p>The controller records executed notional, solves the next fee pair, and Nuthatch indexes the receipt for the UI.</p>
          </article>
        </div>
      </div>

      <div className="landing-proof">
        <span>LIVE TESTNET</span>
        <strong>World identity · 1inch Aqua + SwapVM · The Graph Nuthatch</strong>
        <button onClick={() => onNavigate('protocol')} type="button">Inspect protocol ↗</button>
      </div>
    </section>
  );
}
