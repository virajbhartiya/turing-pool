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
            receives the tighter rate, anonymous flow pays the wider rate, and both move
            with executed volume.
          </p>
          <div className="landing-actions">
            <button onClick={() => onNavigate('trade')} type="button">Open live market</button>
            <button className="secondary" onClick={() => onNavigate('pool')} type="button">Provide liquidity</button>
          </div>
        </div>
        <div className="landing-market">
          <span>Live Base Sepolia schedule</span>
          <div><small>Verified</small><strong>{controller.tightFeeBps}<em>bps</em></strong></div>
          <div><small>Anonymous</small><strong>{controller.wideFeeBps}<em>bps</em></strong></div>
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
          <small>
            h = verified volume ÷ total volume · {formatUnits(controller.tightVolume)} tETH
            verified / {formatUnits(controller.wideVolume)} tETH anonymous
          </small>
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
            <strong>Resolve identity</strong>
            <p>World AgentBook maps the wallet to a humanId; the Base mirror makes it executable.</p>
          </article>
          <i>→</i>
          <article>
            <span>02</span>
            <BrandLogo brand="oneinch" />
            <strong>Run opcode 34</strong>
            <p>HumanGate selects the tight or wide fee and enforces the shared human quota.</p>
          </article>
          <i>→</i>
          <article>
            <span>03</span>
            <BrandLogo brand="oneinch" />
            <strong>Settle through Aqua</strong>
            <p>SwapVM executes against maker inventory and records the realized volume on-chain.</p>
          </article>
          <i>→</i>
          <article>
            <span>04</span>
            <BrandLogo brand="nuthatch" />
            <strong>Index the receipt</strong>
            <p>Nuthatch makes the fill, lane, fee, and next market state queryable.</p>
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
