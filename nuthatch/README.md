# Turing Pool Nuthatch nest

This nest indexes the live World Chain market:

- identity decisions emitted by `_humanGate` on the active vault router
- real SwapVM fills settled from Aqua virtual balances
- active-vault deposits, withdrawals, and LP-share accounting
- HumanQuota usage and activity-priced fee updates

The contracts use World Chain `tETH/tUSD` test assets. They exercise the real
deployed Aqua and SwapVM code paths, but do not claim Pathfinder liquidity.

## Run

Install Nuthatch 0.6.1 or newer, then start the nest from the repository root:

```bash
pnpm nuthatch:dev
```

The checked-in public World Chain RPC is a fallback. The following tested
public endpoint supports large historical windows, allowing Nuthatch to seal
the full deployment history quickly:

```bash
NUTHATCH_RPC_URL=https://worldchain-mainnet.gateway.tenderly.co \
NUTHATCH_LOG_WINDOW=100000 \
NUTHATCH_SEAL_DIRECT=1 \
NUTHATCH_CONCURRENCY=4 \
pnpm nuthatch:dev
```

If a provider limits `eth_getLogs`, run the checked-in proxy. It splits
Nuthatch's adaptive ranges, spaces requests, and merges the responses:

```bash
RPC_UPSTREAM_URL=https://worldchain-mainnet.g.alchemy.com/public \
RPC_PROXY_PORT=8547 \
RPC_MAX_LOG_BLOCK_RANGE=100 \
pnpm rpc-proxy

NUTHATCH_RPC_URL=http://127.0.0.1:8547 \
NUTHATCH_LOG_WINDOW=4000 \
pnpm nuthatch:dev
```

Nuthatch serves its admin UI at `http://127.0.0.1:8288/_admin/`. Start the
Turing Pool API with `NUTHATCH_URL=http://127.0.0.1:8288`; the dashboard will
then show Nuthatch's indexed block and use its correlated trade and LP rows.
The live dashboard fails closed while this load-bearing index is unavailable;
it never substitutes mocked or stale activity.

The project command honors each contract's checked-in deployment block. Set
`NUTHATCH_BACKFILL_BLOCKS` only when you explicitly want recent-history mode.
Start Nuthatch, execute trades in the terminal, and watch those World receipts
arrive.

Useful queries:

```bash
nuthatch sql --dir nuthatch \
  'SELECT * FROM turing_all_trades ORDER BY block_number DESC, log_index DESC LIMIT 10'

nuthatch sql --dir nuthatch \
  'SELECT * FROM turing_activity_mix'

nuthatch sql --dir nuthatch \
  'SELECT * FROM turing_risk_window'

nuthatch sql --dir nuthatch \
  'SELECT * FROM turing_fee_history ORDER BY block_number DESC, log_index DESC'

nuthatch sql --dir nuthatch \
  'SELECT * FROM active_vault__liquidity_added ORDER BY block_number DESC, log_index DESC'
```
