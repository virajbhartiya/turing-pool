# Turing Pool Nuthatch nest

This nest indexes the live World Chain deployment used by the demo:

- World AgentBook decisions emitted by `_humanGate` on the SwapVM router
- real SwapVM fills settled from Aqua virtual balances
- HumanQuota usage and activity-priced fee updates
- Aqua strategy shipping and docking

The contracts use demo `tETH/tUSD` assets. They exercise the real deployed Aqua
and SwapVM code paths, but they do not claim production 1inch Pathfinder
liquidity.

## Run

Install Nuthatch 0.6.1 or newer, then start the nest from the repository root:

```bash
pnpm nuthatch:dev
```

The checked-in public World RPC is intentionally only a fallback. For a reliable
judge demo, supply a private World Chain RPC:

```bash
NUTHATCH_RPC_URL=https://your-world-rpc.example pnpm nuthatch:dev
```

Nuthatch serves its admin UI at `http://127.0.0.1:8288/_admin/`. Start the
Turing Pool API with `NUTHATCH_URL=http://127.0.0.1:8288`; the dashboard will
then show Nuthatch's indexed block and use its correlated trade rows. If the
indexer is unavailable, settlement continues and the API falls back to direct
chain events.

The public World RPC only accepts narrow log ranges. The project command starts
with a five-block window so Nuthatch's adaptive window remains below that
provider limit. It intentionally indexes from the recent tip for the live demo:
start Nuthatch, execute trades in the terminal, and watch those receipts arrive.

Useful queries:

```bash
nuthatch sql --dir nuthatch \
  'SELECT * FROM turing_trades ORDER BY block_number DESC, log_index DESC LIMIT 10'

nuthatch sql --dir nuthatch \
  'SELECT * FROM turing_activity_mix'
```
