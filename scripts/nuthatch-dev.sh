#!/usr/bin/env bash
set -euo pipefail

if ! command -v nuthatch >/dev/null 2>&1; then
  echo "nuthatch is required: https://nuthatch.thegraph.com/" >&2
  exit 1
fi

if [[ -n "${NUTHATCH_RPC_URL:-}" ]]; then
  exec nuthatch dev \
    --dir nuthatch \
    --backfill "${NUTHATCH_BACKFILL_BLOCKS:-100}" \
    --window "${NUTHATCH_LOG_WINDOW:-5}" \
    --rpc "$NUTHATCH_RPC_URL"
fi

exec nuthatch dev \
  --dir nuthatch \
  --backfill "${NUTHATCH_BACKFILL_BLOCKS:-100}" \
  --window "${NUTHATCH_LOG_WINDOW:-5}"
