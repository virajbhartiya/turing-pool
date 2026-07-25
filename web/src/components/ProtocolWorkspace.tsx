import {
  addressExplorer,
  formatUnits,
  shortAddress,
  transactionExplorer,
} from '../lib/format';
import type { DemoTradeResult, ProtocolState } from '../types';
import { BrandLogo } from './BrandLogo';
import { EvidenceLedger } from './EvidenceLedger';
import { SourceCodeGuide } from './SourceCodeGuide';

interface ProtocolWorkspaceProps {
  state: ProtocolState;
  lastTrade?: DemoTradeResult;
}

interface ContractLinkProps {
  address?: string;
  chainId: number;
  label: string;
}

function ContractLink({ address, chainId, label }: ContractLinkProps) {
  const href = addressExplorer(chainId, address);
  return (
    <div>
      <span>{label}</span>
      {href ? (
        <a href={href} rel="noreferrer" target="_blank">
          {shortAddress(address)} ↗
        </a>
      ) : (
        <code>{shortAddress(address)}</code>
      )}
    </div>
  );
}

export function ProtocolWorkspace({ state, lastTrade }: ProtocolWorkspaceProps) {
  const controller = state.feeController;
  const executionChainId = state.runtime.chainId;
  const identityChainId = state.contracts.identitySourceChainId ?? 480;
  const humanShare = controller.humanShareBps / 100;
  const searcherShare = 100 - humanShare;
  const latestSwap = state.swaps.at(-1);
  const latestTransactionHash = lastTrade?.transactionHash ?? latestSwap?.transactionHash;
  const latestReceipt = transactionExplorer(executionChainId, latestTransactionHash);
  const latestTaker = lastTrade?.wallet ?? latestSwap?.taker ?? state.execution?.humanWallet;
  const latestHumanId = lastTrade?.humanId ?? latestSwap?.humanId;
  const latestTight = lastTrade?.tight ?? latestSwap?.tight;
  const latestFee = lastTrade?.feeBps ?? Number(latestSwap?.feeBps ?? controller.tightFeeBps);
  const latestBlock = lastTrade?.blockNumber ?? latestSwap?.blockNumber;
  const indexer = state.dataSources.activity;
  const quotaToken = lastTrade?.tokenInSymbol ?? 'fixed-input token';

  return (
    <section className="protocol-explainer">
      <header className="protocol-hero">
        <div>
          <span className="eyebrow">Protocol anatomy</span>
          <h1>Verified retail becomes executable market structure.</h1>
          <p>
            World AgentKit establishes accountable agency. The same custom SwapVM
            program prices every quote and fill, Aqua settles LP inventory, and
            Nuthatch turns confirmed activity into an agent-readable feedback signal.
          </p>
        </div>
        <dl>
          <div>
            <dt>Instruction</dt>
            <dd>OP {state.execution?.opcode ?? 34}</dd>
          </div>
          <div>
            <dt>Current schedule</dt>
            <dd>{controller.tightFeeBps} / {controller.wideFeeBps} bps</dd>
          </div>
          <div>
            <dt>Configured LP target</dt>
            <dd>{controller.targetFeeBps} bps</dd>
          </div>
          <div>
            <dt>Indexer</dt>
            <dd className={indexer.status === 'connected' ? 'positive' : undefined}>
              {indexer.status === 'connected'
                ? `LIVE · ${indexer.lagBlocks ?? 0} block lag`
                : indexer.status.toUpperCase()}
            </dd>
          </div>
        </dl>
      </header>

      <div className="protocol-phases" aria-label="Transaction phases">
        <div>
          <span>01 · READ-ONLY QUOTE</span>
          <strong>Same bytecode, no state writes</strong>
          <small>Wallet intent → identity → fee → amount out</small>
        </div>
        <div>
          <span>02 · ATOMIC SWAP</span>
          <strong>Repeat checks and move tokens</strong>
          <small>Any changed balance, quota, or allowance reverts safely</small>
        </div>
        <div>
          <span>03 · FEEDBACK</span>
          <strong>Confirmed volume reprices the next fill</strong>
          <small>Events → controller state → Nuthatch SQL + MCP</small>
        </div>
      </div>

      <div className="protocol-pipeline">
        <article className="identity">
          <header>
            <b>01</b>
            <BrandLogo brand="world" />
            <span>Identity read</span>
          </header>
          <h2>Resolve the taker</h2>
          <p>
            World verification registers the trading wallet in AgentBook.
            The execution mirror returns only its canonical human ID; no proof or
            biometric data enters the swap.
          </p>
          <dl>
            <div><dt>CALL</dt><dd><code>lookupHuman(taker)</code></dd></div>
            <div><dt>INPUT</dt><dd>{shortAddress(latestTaker)}</dd></div>
            <div>
              <dt>OUTPUT</dt>
              <dd>
                {latestHumanId && latestHumanId !== '0'
                  ? `humanId ${latestHumanId.slice(0, 12)}…`
                  : latestHumanId === '0'
                    ? 'humanId 0 · searcher lane'
                    : 'non-zero → verified retail · zero → searcher'}
              </dd>
            </div>
          </dl>
        </article>

        <article className="gate">
          <header>
            <b>02</b>
            <BrandLogo brand="oneinch" />
            <span>SwapVM instruction</span>
          </header>
          <h2>Opcode 34 prices risk</h2>
          <p>
            <code>_humanGate</code> runs before swap math. It reads the fee schedule and
            per-human quota for the token whose amount the taker fixed.
          </p>
          <dl>
            <div><dt>READS</dt><dd><code>feeSchedule({quotaToken})</code></dd></div>
            <div><dt>CHECKS</dt><dd><code>remaining(humanId, token) ≥ amount</code></dd></div>
            <div>
              <dt>SELECTS</dt>
              <dd className={latestTight ? 'positive' : 'negative'}>
                {latestTight === undefined
                  ? `${controller.tightFeeBps} bps verified retail / ${controller.wideFeeBps} bps searcher`
                  : `${latestTight ? 'VERIFIED RETAIL' : 'SEARCHER'} · ${latestFee} bps`}
              </dd>
            </div>
          </dl>
        </article>

        <article className="controller">
          <header>
            <b>03</b>
            <span className="brand-logo brand-logo-turing" aria-hidden="true">TP</span>
            <span>Fee feedback</span>
          </header>
          <h2>Record notional and solve again</h2>
          <p>
            In transaction context, HumanGate records the lane and fixed amount before
            continuing. If settlement later fails, this write reverts with the swap.
          </p>
          <dl>
            <div><dt>WRITE</dt><dd><code>recordTrade(orderHash, humanId, token, amount, lane)</code></dd></div>
            <div><dt>VOLUME</dt><dd>{formatUnits(controller.tightVolume)} verified retail · {formatUnits(controller.wideVolume)} searcher</dd></div>
            <div><dt>NEXT</dt><dd>{controller.tightFeeBps} / {controller.wideFeeBps} bps</dd></div>
          </dl>
        </article>

        <article className="settlement">
          <header>
            <b>04</b>
            <BrandLogo brand="oneinch" />
            <span>Aqua settlement</span>
          </header>
          <h2>Execute against live inventory</h2>
          <p>
            SwapVM reads the vault’s shipped strategy and Aqua safe balances, computes
            the output, then pushes input and pulls output atomically.
          </p>
          <dl>
            <div><dt>READS</dt><dd><code>safeBalances(maker, router, orderHash, tokens)</code></dd></div>
            <div>
              <dt>INVENTORY</dt>
              <dd>{formatUnits(state.pool.balance0, 18, 1)} tETH · {formatUnits(state.pool.balance1, 18, 0)} tUSD</dd>
            </div>
            <div><dt>PROOF</dt><dd><code>HumanGated + Swapped</code></dd></div>
          </dl>
        </article>

        <article className="index">
          <header>
            <b>05</b>
            <BrandLogo brand="nuthatch" />
            <span>Indexed proof</span>
          </header>
          <h2>Index activity and drive policy</h2>
          <p>
            Nuthatch joins confirmed gate and swap events into a normalized 50-fill
            risk window. The strategist cannot update fees without this fresh SQL
            result; settlement and the 30 bps invariant remain enforced on-chain.
          </p>
          <dl>
            <div><dt>QUERY</dt><dd><code>SELECT * FROM turing_risk_window</code></dd></div>
            <div><dt>POLICY BLOCK</dt><dd>{state.riskPolicy?.indexedThroughBlock && state.riskPolicy.indexedThroughBlock !== '0' ? state.riskPolicy.indexedThroughBlock : 'awaiting first decision'}</dd></div>
            <div><dt>GUARD</dt><dd className={indexer.status === 'connected' ? 'positive' : undefined}>≤ {state.riskPolicy?.maxFeeStepBps ?? '—'} bps step · ≤ {state.riskPolicy?.maxDataLagBlocks ?? '—'} blocks old</dd></div>
          </dl>
        </article>
      </div>

      <SourceCodeGuide />

      <div className="protocol-deep-dive">
        <article className="protocol-invariant">
          <div>
            <span className="eyebrow">The pricing invariant</span>
            <h2>Different lane prices. One blended LP rate.</h2>
            <p>
              The controller measures executed volume by lane and solves the next two
              rates so their volume-weighted fee remains at the LP target.
            </p>
          </div>
          <div className="protocol-equation">
            <div>
              <span>Verified retail</span>
              <strong>{controller.tightFeeBps}<small>bps</small></strong>
              <em>× {humanShare.toFixed(0)}%</em>
            </div>
            <i>+</i>
            <div>
              <span>Searcher</span>
              <strong>{controller.wideFeeBps}<small>bps</small></strong>
              <em>× {searcherShare.toFixed(0)}%</em>
            </div>
            <i>=</i>
            <div className="target">
              <span>Projected LP fee</span>
              <strong>{controller.projectedWeightedFeeBps.toFixed(1)}<small>bps</small></strong>
              <em>target {controller.targetFeeBps} bps</em>
            </div>
          </div>
          <code className="protocol-formula">
            f<sub>agent</sub> = target − spread × searcherShare
            <span>·</span>
            f<sub>searcher</sub> absorbs the rounded remainder
          </code>
        </article>

        <article className="protocol-contracts">
          <header>
            <span className="eyebrow">Live contract map</span>
            <b>OPEN ANY CONTRACT ↗</b>
          </header>
          <section>
            <h3>Identity</h3>
            <ContractLink
              address={state.contracts.identitySourceAgentBook}
              chainId={identityChainId}
              label="Canonical AgentBook"
            />
            <ContractLink
              address={state.contracts.identityMirror ?? state.contracts.agentBook}
              chainId={executionChainId}
              label="World identity mirror"
            />
          </section>
          <section>
            <h3>Execution</h3>
            <ContractLink address={state.contracts.router} chainId={executionChainId} label="SwapVM router + opcode 34" />
            <ContractLink address={state.contracts.aqua} chainId={executionChainId} label="Aqua" />
            <ContractLink address={state.contracts.quota} chainId={executionChainId} label="HumanQuota controller" />
            <ContractLink address={state.contracts.demoVault} chainId={executionChainId} label="LP vault / maker" />
          </section>
          <section>
            <h3>Strategy</h3>
            <div><span>Active order hash</span><code>{shortAddress(state.pool.strategyHash)}</code></div>
            <div><span>Runtime block</span><code>{state.runtime.latestBlock}</code></div>
          </section>
        </article>
      </div>

      <article className="protocol-latest-receipt">
        <header>
          <div>
            <span className="eyebrow">Latest end-to-end proof</span>
            <h2>{latestBlock ? `Fill confirmed in block ${latestBlock}` : 'Waiting for the first fill'}</h2>
          </div>
          {latestReceipt && <a href={latestReceipt} rel="noreferrer" target="_blank">Open receipt ↗</a>}
        </header>
        <dl>
          <div><dt>TAKER</dt><dd>{shortAddress(latestTaker)}</dd></div>
          <div>
            <dt>IDENTITY RESULT</dt>
            <dd>
              {latestTight === undefined
                ? 'Awaiting fill'
                : latestTight
                  ? 'World ID-verified retail'
                  : 'Autonomous searcher'}
            </dd>
          </div>
          <div><dt>APPLIED FEE</dt><dd>{latestFee} bps</dd></div>
          <div><dt>ORDER</dt><dd>{shortAddress(lastTrade?.orderHash ?? state.pool.strategyHash)}</dd></div>
          <div><dt>INDEX STATUS</dt><dd>{indexer.status === 'connected' ? `Indexed · ${indexer.lagBlocks ?? 0} lag` : 'Chain fallback'}</dd></div>
        </dl>
      </article>

      <EvidenceLedger state={state} />
    </section>
  );
}
