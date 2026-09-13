import { formatUnits, shortAddress, transactionExplorer } from '../lib/format';
import type { ProtocolState, Swap } from '../types';

export function ActivityTable({ state, swaps = state.swaps, limit = 12 }: { state: ProtocolState; swaps?: Swap[]; limit?: number }) {
  const rows = swaps.slice().reverse().slice(0, limit);
  if (!rows.length) return <div className="empty-state"><span className="empty-symbol" aria-hidden="true">↔</span><h3>No trades yet</h3><p>Confirmed market transactions will appear here.</p></div>;
  return (
    <div className="table-scroll">
      <table className="activity-table">
        <thead><tr><th>Transaction</th><th>Paid</th><th>Received</th><th>Rate</th><th>Wallet</th><th>Block</th></tr></thead>
        <tbody>{rows.map((swap, index) => {
          const tokenIn = swap.tokenIn.toLowerCase() === state.pool.token0.toLowerCase() ? 'tETH' : 'tUSD';
          const tokenOut = tokenIn === 'tETH' ? 'tUSD' : 'tETH';
          const href = state.runtime.mode === 'hosted-preview' ? undefined : transactionExplorer(state.runtime.chainId, swap.transactionHash);
          return <tr key={`${swap.transactionHash ?? swap.blockNumber}-${index}`}>
            <td><span className="transaction-label"><i aria-hidden="true">↗</i>{href ? <a href={href} target="_blank" rel="noreferrer">Swap <span className="visually-hidden">{shortAddress(swap.transactionHash)}</span></a> : 'Swap'}</span></td>
            <td>{formatUnits(swap.amountIn, 18, tokenIn === 'tETH' ? 5 : 2)} <span className="muted">{tokenIn}</span></td>
            <td>{formatUnits(swap.amountOut, 18, tokenOut === 'tETH' ? 5 : 2)} <span className="muted">{tokenOut}</span></td>
            <td><span className={`rate-pill ${swap.tight ? 'verified' : ''}`}>{swap.tight ? 'Verified' : 'Standard'}</span></td>
            <td className="mono muted">{shortAddress(swap.taker)}</td><td className="mono muted">{swap.blockNumber}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}
