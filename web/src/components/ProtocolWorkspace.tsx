import { useState } from 'react';
import { addressExplorer, shortAddress, transactionExplorer } from '../lib/format';
import type { DemoTradeResult, ProtocolState } from '../types';
import { ActivityTable } from './ActivityTable';

export function ProtocolWorkspace({ state, lastTrade }: { state: ProtocolState; lastTrade?: DemoTradeResult }) {
  const [filter, setFilter] = useState<'all' | 'verified' | 'standard'>('all');
  const swaps = state.swaps.filter((swap) => filter === 'all' || swap.tight === (filter === 'verified'));
  const indexer = state.dataSources.activity;
  const contracts = [
    ['Identity registry', state.contracts.agentBook], ['Aqua settlement', state.contracts.aqua],
    ['Trading router', state.contracts.router], ['Liquidity vault', state.contracts.activeVault],
    ['Fee controller', state.contracts.quota],
  ];
  return (
    <section className="activity-page">
      <header className="page-heading"><div><span className="eyebrow">Market</span><h1>Activity</h1><p>Every confirmed trade, with a receipt you can inspect.</p></div><span className={`page-badge ${indexer.status === 'connected' ? 'connected' : ''}`}><i />{indexer.status === 'connected' ? 'Indexer connected' : 'Indexer unavailable'}</span></header>
      {lastTrade && <a className="receipt-notice" href={transactionExplorer(state.runtime.chainId, lastTrade.transactionHash)} target="_blank" rel="noreferrer"><span className="receipt-check">✓</span><span><strong>Your latest swap is confirmed</strong><small>{shortAddress(lastTrade.transactionHash)} · Block {lastTrade.blockNumber}</small></span><span>View receipt ↗</span></a>}
      <article className="surface activity-surface">
        <header className="card-heading"><div><h2>Market transactions</h2><p>{swaps.length} indexed {swaps.length === 1 ? 'trade' : 'trades'}</p></div><div className="segmented-control" aria-label="Filter transactions">{(['all', 'verified', 'standard'] as const).map((value) => <button key={value} className={filter === value ? 'active' : undefined} aria-pressed={filter === value} onClick={() => setFilter(value)} type="button">{value === 'all' ? 'All trades' : value === 'verified' ? 'Verified' : 'Standard'}</button>)}</div></header>
        <ActivityTable state={state} swaps={swaps} limit={100} />
      </article>
      <details className="surface technical-details"><summary><span>Network & contracts</span><span>View details</span></summary><div className="contract-grid">{contracts.map(([label, address]) => <div key={label}><span>{label}</span>{address ? <a href={addressExplorer(state.runtime.chainId, address)} target="_blank" rel="noreferrer">{shortAddress(address)} ↗</a> : <span>Unavailable</span>}</div>)}</div><p className="technical-note">Indexed by Nuthatch · {indexer.status === 'connected' ? 'Connected' : 'Unavailable'} · {state.runtime.label}</p><a className="text-link" href="https://github.com/virajbhartiya/turing-pool" target="_blank" rel="noreferrer">Explore the protocol source ↗</a></details>
    </section>
  );
}
