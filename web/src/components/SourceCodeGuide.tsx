import type { ReactNode } from 'react';

import { BrandLogo } from './BrandLogo';

const REPOSITORY_URL = 'https://github.com/virajbhartiya/turing-pool';
const SOURCE_ROOT = `${REPOSITORY_URL}/blob/agent/shared-lp-vault`;

function source(path: string, lines?: string) {
  return `${SOURCE_ROOT}/${path}${lines ? `#${lines}` : ''}`;
}

function SourceLink({
  children,
  path,
  lines,
}: {
  children: ReactNode;
  path: string;
  lines?: string;
}) {
  return (
    <a href={source(path, lines)} rel="noreferrer" target="_blank">
      {children} ↗
    </a>
  );
}

export function SourceCodeGuide() {
  return (
    <section className="source-guide">
      <header>
        <div>
          <span className="eyebrow">Implementation map</span>
          <h2>Read the protocol in source.</h2>
          <p>
            These are the exact integration points behind the live market—not illustrative
            pseudocode. Each module links to the implementation that judges can inspect.
          </p>
        </div>
        <a className="repository-link" href={REPOSITORY_URL} rel="noreferrer" target="_blank">
          View GitHub repository ↗
        </a>
      </header>

      <div className="source-guide-grid">
        <article className="world">
          <div className="source-card-head">
            <BrandLogo brand="world" />
            <div><span>World</span><strong>AgentKit + AgentBook</strong></div>
          </div>
          <h3>Resolve World ID verification</h3>
          <p>
            The API returns an AgentKit 402 challenge. The agent signs the SIWE payload,
            the server verifies it, and opcode 34 resolves the same signer directly in
            canonical AgentBook on World Chain during execution.
          </p>
          <pre><code>{`const validation = await validateAgentkitMessage(payload, resourceUri, {
  maxAge: 5 * 60_000,
  checkNonce: async (nonce) => !(await storage.hasUsedNonce(nonce)),
});
const verification = await verifyAgentkitSignature(
  payload,
  process.env.RPC_URL ?? 'http://127.0.0.1:8545',
);
const humanId = await lookupHuman(verification.address as \`0x\${string}\`);`}</code></pre>
          <footer>
            <SourceLink path="server/src/app.ts" lines="L305-L360">AgentKit challenge + verification</SourceLink>
            <SourceLink path="contracts/src/swapvm/HumanGate.sol" lines="L45-L83">Direct AgentBook lookup</SourceLink>
            <SourceLink path="agent/src/human-agent.ts">World ID-verified client</SourceLink>
          </footer>
        </article>

        <article className="swapvm">
          <div className="source-card-head">
            <BrandLogo brand="oneinch" />
            <div><span>1inch SwapVM</span><strong>Custom instruction 34</strong></div>
          </div>
          <h3>Insert identity before swap math</h3>
          <p>
            The router keeps the standard SwapVM and Aqua instruction table, then
            appends <code>_humanGate</code> as opcode 34. It resolves AgentBook, checks
            the shared per-human quota, selects the live fee, and continues through the
            remaining SwapVM program.
          </p>
          <pre><code>{`result[base.length] = _humanGate; // opcode 34
uint256 humanId = agentBook.lookupHuman(ctx.query.taker);
if (humanId != 0 && quota.remaining(humanId, quotaToken) >= quotaAmount) {
    tight = true;
    feeE9 = tightFeeBps * 1e5;
}
ctx.runLoop();`}</code></pre>
          <footer>
            <SourceLink path="contracts/src/swapvm/TuringPoolRouter.sol" lines="L10-L43">Router opcode registration</SourceLink>
            <SourceLink path="contracts/src/swapvm/HumanGate.sol" lines="L45-L83">HumanGate instruction</SourceLink>
            <SourceLink path="agent/src/router-agent.ts" lines="L153-L239">End-to-end opcode receipt proof</SourceLink>
          </footer>
        </article>

        <article className="aqua">
          <div className="source-card-head">
            <BrandLogo brand="oneinch" />
            <div><span>1inch Aqua</span><strong>Shared LP inventory</strong></div>
          </div>
          <h3>Ship a live identity-priced strategy</h3>
          <p>
            LP deposits mint transferable vault shares. The vault encodes HumanGate,
            constant-product swap math, and a salt into one SwapVM program, then ships
            its two-token inventory into Aqua. Deposits and withdrawals dock and re-ship
            atomically so the executable strategy always matches vault reserves.
          </p>
          <pre><code>{`bytes memory program = bytes.concat(
    abi.encodePacked(
        OP_HUMAN_GATE,
        uint8(48),
        HumanGateArgsBuilder.build(
            AGENT_BOOK, address(QUOTA), FALLBACK_WIDE_FEE_E9, FALLBACK_TIGHT_FEE_E9
        )
    ),
    abi.encodePacked(OP_XYC_SWAP, uint8(0)),
    abi.encodePacked(OP_SALT, uint8(8), strategyNonce)
);
bytes32 nextOrderHash =
    AQUA.ship(address(ROUTER), abi.encode(order), tokens, amounts);`}</code></pre>
          <footer>
            <SourceLink path="contracts/src/vault/TuringPoolVault.sol" lines="L152-L192">LP deposit + redemption</SourceLink>
            <SourceLink path="contracts/src/vault/TuringPoolVault.sol" lines="L217-L270">Aqua dock + ship lifecycle</SourceLink>
            <SourceLink path="contracts/src/vault/TuringPoolVaultFactory.sol" lines="L61-L76">Permissionless vault factory</SourceLink>
          </footer>
        </article>

        <article className="controller">
          <div className="source-card-head">
            <span className="brand-logo brand-logo-turing" aria-hidden="true">TP</span>
            <div><span>Turing Pool</span><strong>On-chain fee controller</strong></div>
          </div>
          <h3>Reprice from executed notional</h3>
          <p>
            HumanGate records the fixed-input amount only in transaction context. The
            controller adds volume to the executed lane and solves the next fee pair
            around the LP target. Because it is called inside the SwapVM transaction,
            a failed settlement also reverts the volume update.
          </p>
          <pre><code>{`if (tight) {
    uint256 nextTightVolume = uint256(controller.tightVolume) + amount;
    controller.tightVolume = uint128(nextTightVolume);
} else {
    uint256 nextWideVolume = uint256(controller.wideVolume) + amount;
    controller.wideVolume = uint128(nextWideVolume);
}
_reprice(token);
emit FeeScheduleUpdated(
    token, controller.tightFeeBps, controller.wideFeeBps,
    controller.tightVolume, controller.wideVolume,
    uint256(controller.tightVolume) * 10_000 / totalVolume
);`}</code></pre>
          <footer>
            <SourceLink path="contracts/src/HumanQuota.sol" lines="L155-L175">Live fee schedule</SourceLink>
            <SourceLink path="contracts/src/HumanQuota.sol" lines="L196-L242">Order-bound volume accounting</SourceLink>
            <SourceLink path="contracts/src/HumanQuota.sol" lines="L244-L294">Revenue-neutral solver</SourceLink>
          </footer>
        </article>

        <article className="graph">
          <div className="source-card-head">
            <BrandLogo brand="nuthatch" />
            <div><span>The Graph</span><strong>Nuthatch + pricing agent</strong></div>
          </div>
          <h3>Turn receipts into an agent-readable signal</h3>
          <p>
            Nuthatch indexes HumanGated, Swapped, vault, and Aqua lifecycle
            events from the live deployment. SQL views aggregate volume by lane and MCP
            exposes the same schema to agents. The strategist consumes activity and can
            dock and re-ship a re-parameterized Aqua strategy; settlement safety remains
            entirely on-chain.
          </p>
          <pre><code>{`SELECT
  sum(amount_in_dec) FILTER (WHERE tight) AS tight_volume,
  sum(amount_in_dec) FILTER (WHERE NOT tight) AS wide_volume,
  round(
    10000 * sum(amount_in_dec) FILTER (WHERE tight)
    / nullif(sum(amount_in_dec), 0)
  ) AS human_share_bps
FROM turing_trades;`}</code></pre>
          <footer>
            <SourceLink path="nuthatch/schema.json">Live event schema</SourceLink>
            <SourceLink path="nuthatch/views/20-activity-mix.sql" lines="L1-L16">Activity-mix SQL view</SourceLink>
            <SourceLink path="nuthatch/semantic.toml">MCP semantic layer</SourceLink>
            <SourceLink path="agent/src/strategist.ts" lines="L235-L298">Pricing-agent action loop</SourceLink>
          </footer>
        </article>
      </div>
    </section>
  );
}
