import { formatUnits, shortAddress, transactionExplorer } from '../lib/format';
import type { ProtocolState } from '../types';

interface EvidenceLedgerProps {
  state: ProtocolState;
}

export function EvidenceLedger({ state }: EvidenceLedgerProps) {
  const isSnapshot = state.runtime.mode === 'hosted-preview';

  return (
    <section className="evidence-section">
      <div className="section-head">
        <div><span>Audit trail</span><h2>On-chain receipts</h2></div>
        <p>{isSnapshot ? 'Recorded lifecycle · run locally for live links' : 'Select a block to verify the fill independently'}</p>
      </div>

      <div className="ledger-panel">
        <div className="panel-head">
          <div><strong>Settlement ledger</strong><span>Latest fills · newest first</span></div>
          <span className="live-tag">{state.swaps.length} EVENTS</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Block / receipt</th><th>Path</th><th>Taker</th><th>Tier</th><th>Amount in</th><th>Amount out</th><th>Fee</th><th>humanId</th></tr>
            </thead>
            <tbody>
              {state.swaps.slice().reverse().slice(0, 12).map((swap) => {
                const href = !isSnapshot ? transactionExplorer(state.runtime.chainId, swap.transactionHash) : undefined;
                const tokenIn = swap.tokenIn.toLowerCase() === state.pool.token0.toLowerCase() ? 'tETH' : 'tUSD';
                const tokenOut = swap.tokenOut.toLowerCase() === state.pool.token0.toLowerCase() ? 'tETH' : 'tUSD';
                return (
                  <tr key={`${swap.blockNumber}-${swap.transactionHash ?? swap.taker}`}>
                    <td>{href ? <a href={href} rel="noreferrer" target="_blank">{swap.blockNumber} ↗</a> : swap.blockNumber}</td>
                    <td className="mono">{swap.source === 'swapvm' ? 'OP #34' : 'APP'}</td>
                    <td className="mono">{shortAddress(swap.taker)}</td>
                    <td><span className={`tier ${swap.tight ? 'human' : 'bot'}`}><i />{swap.tight ? 'tight' : 'wide'}</span></td>
                    <td>{formatUnits(swap.amountIn)} {tokenIn}</td>
                    <td>{formatUnits(swap.amountOut)} {tokenOut}</td>
                    <td>{swap.feeBps} bps</td>
                    <td className="mono">{swap.humanId === '0' ? '—' : `${swap.humanId.slice(0, 10)}…`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
