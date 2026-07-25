# Turing Pool Nuthatch nest

This nest indexes the live World Chain market:

- canonical World AgentBook identity reads
- identity decisions emitted by `_humanGate` on the primary and vault routers
- real SwapVM fills settled from Aqua virtual balances
- HumanQuota usage and activity-priced fee updates
- Aqua strategy shipping and docking

The contracts use World Chain `tETH/tUSD` test assets. They exercise the real
deployed Aqua and SwapVM code paths, but do not claim Pathfinder liquidity.

## Run

Install Nuthatch 0.6.1 or newer, then start the nest from the repository root:

```bash
pnpm nuthatch:dev
```

The checked-in public World Chain RPC is a fallback. For a reliable live
market, supply a dedicated World Chain RPC:

```bash
NUTHATCH_RPC_URL=https://your-world-chain-rpc.example pnpm nuthatch:dev
```

If a provider limits `eth_getLogs`, run the checked-in proxy. It splits
Nuthatch's adaptive ranges, spaces requests, and merges the responses:

```bash
RPC_UPSTREAM_URL=https://your-world-chain-rpc.example \
RPC_PROXY_PORT=8547 \
pnpm rpc-proxy

NUTHATCH_RPC_URL=http://127.0.0.1:8547 \
NUTHATCH_LOG_WINDOW=50 \
pnpm nuthatch:dev
```

Nuthatch serves its admin UI at `http://127.0.0.1:8288/_admin/`. Start the
Turing Pool API with `NUTHATCH_URL=http://127.0.0.1:8288`; the dashboard will
then show Nuthatch's indexed block and use its correlated trade rows. If the
indexer is unavailable, settlement continues and the API falls back to direct
chain events.

The project command honors each contract's checked-in deployment block. Set
`NUTHATCH_BACKFILL_BLOCKS` only when you explicitly want recent-history mode.
Start Nuthatch, execute trades in the terminal, and watch those World receipts
arrive.

Useful queries:

```bash
nuthatch sql --dir nuthatch \
  'SELECT * FROM turing_trades ORDER BY block_number DESC, log_index DESC LIMIT 10'

nuthatch sql --dir nuthatch \
  'SELECT * FROM turing_activity_mix'

nuthatch sql --dir nuthatch \
  'SELECT * FROM turing_fee_history ORDER BY block_number DESC, log_index DESC'
```
