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
            Human-backed agents trade tighter.
            <br />
            LP economics stay whole.
          </h1>
          <p>
            World AgentKit proves accountable agency. A custom SwapVM instruction turns
            that proof into bounded economic risk, Aqua settles against LP inventory,
            and Nuthatch makes every fill available to the pricing loop.
          </p>
          <div className="landing-actions">
            <button onClick={() => onNavigate('trade')} type="button">Open live market</button>
            <button className="secondary" onClick={() => onNavigate('pool')} type="button">Provide liquidity</button>
          </div>
        </div>
        <div className="landing-market">
          <span>Live adaptive fee schedule</span>
          <div><small>Human-backed agent</small><strong>{controller.tightFeeBps}<em>bps</em></strong></div>
          <div><small>Autonomous searcher</small><strong>{controller.wideFeeBps}<em>bps</em></strong></div>
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
              <span>Human-backed fee</span>
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
            <div><dt>Output</dt><dd>The next human-backed and searcher fee pair</dd></div>
          </dl>
          <p className="math-incentive">
            More searcher volume lowers both next rates; more human-backed volume raises
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
            <p>AgentBook resolves whether the trading agent is backed by a unique human, then the execution mirror selects its bounded risk lane.</p>
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
