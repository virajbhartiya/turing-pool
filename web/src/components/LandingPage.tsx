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
            The same blended fee target for LPs.
          </h1>
          <p>
            World AgentKit connects a trading wallet to a unique World ID. Verified
            retail flow receives the tighter rate, while HFT and arbitrage flow gets
            always-on execution at a variable risk price. Both rates move with volume.
          </p>
          <div className="landing-actions">
            <button onClick={() => onNavigate('trade')} type="button">Open live market</button>
            <button className="secondary" onClick={() => onNavigate('pool')} type="button">Provide liquidity</button>
          </div>
        </div>
        <div className="landing-market">
          <span>Live adaptive fee schedule</span>
          <div><small>Verified retail</small><strong>{controller.tightFeeBps}<em>bps</em></strong></div>
          <div><small>HFT / arbitrage</small><strong>{controller.wideFeeBps}<em>bps</em></strong></div>
          <div className="target"><small>Configured LP target</small><strong>{controller.targetFeeBps}<em>bps</em></strong></div>
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
            <span><i>h</i> × <b>f<sub>verified</sub></b></span>
            <em>+</em>
            <span><i>(1 − h)</i> × <b>f<sub>searcher</sub></b></span>
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
              <span>Verified retail fee</span>
              <code>
                {controller.targetFeeBps} − {(botShare * 100).toFixed(0)}% × {feeSpread}
                {' = '}<b>{controller.tightFeeBps} bps</b>
              </code>
            </div>
            <div>
              <span>Searcher fee</span>
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
            <div><dt>Output</dt><dd>The next verified retail and searcher fee pair</dd></div>
          </dl>
          <p className="math-incentive">
            More searcher volume lowers both next rates; more verified volume raises
            both. The identity signal underwrites a bounded lane rather than granting a
            static perk, while LPs retain the same blended target.
          </p>
        </div>
      </div>

      <div className="landing-flow">
        <div className="landing-section-copy flow-heading">
          <span className="eyebrow">One fill · four verifiable stages</span>
          <h2>From wallet intent to indexed proof.</h2>
          <p>
            Every stage leaves an output that the next stage consumes. The complete
            path can be checked against contracts, receipts, and indexed activity.
          </p>
        </div>
        <div className="event-flow">
          <article>
            <div className="event-step-head">
              <span>01</span>
              <div>
                <BrandLogo brand="world" />
                <small>World AgentBook</small>
              </div>
            </div>
            <strong>Resolve the trader</strong>
            <p>AgentBook resolves the wallet’s World ID status, then the execution mirror selects its bounded risk lane.</p>
            <div className="event-output">
              <span>Output</span>
              <b>humanId → risk lane</b>
            </div>
          </article>
          <i aria-hidden="true"><span>01</span></i>
          <article>
            <div className="event-step-head">
              <span>02</span>
              <div>
                <BrandLogo brand="oneinch" />
                <small>SwapVM · opcode 34</small>
              </div>
            </div>
            <strong>Price the risk</strong>
            <p>HumanGate reads the live fee schedule and shared human quota, then returns the executable amount and fee.</p>
            <div className="event-output">
              <span>Output</span>
              <b>lane + quota → quote</b>
            </div>
          </article>
          <i aria-hidden="true"><span>02</span></i>
          <article>
            <div className="event-step-head">
              <span>03</span>
              <div>
                <BrandLogo brand="oneinch" />
                <small>1inch Aqua</small>
              </div>
            </div>
            <strong>Settle real inventory</strong>
            <p>SwapVM executes against the vault’s Aqua order, moves tokens, and emits HumanGated and Swapped events.</p>
            <div className="event-output">
              <span>Output</span>
              <b>token movement → receipt</b>
            </div>
          </article>
          <i aria-hidden="true"><span>03</span></i>
          <article>
            <div className="event-step-head">
              <span>04</span>
              <div>
                <BrandLogo brand="nuthatch" />
                <small>The Graph · Nuthatch</small>
              </div>
            </div>
            <strong>Reprice and index</strong>
            <p>The controller records realized volume, solves the next fee pair, and Nuthatch makes the proof queryable.</p>
            <div className="event-output">
              <span>Output</span>
              <b>volume → next live rates</b>
            </div>
          </article>
        </div>
      </div>

    </section>
  );
}
