#!/usr/bin/env bash
set -euo pipefail

if ! command -v nuthatch >/dev/null 2>&1; then
  echo "nuthatch is required: https://nuthatch.thegraph.com/" >&2
  exit 1
fi

args=(dev --dir nuthatch --window "${NUTHATCH_LOG_WINDOW:-50}")

if [[ "${NUTHATCH_SEAL_DIRECT:-}" == "1" ]]; then
  args+=(--seal-direct)
fi

if [[ -n "${NUTHATCH_CONCURRENCY:-}" ]]; then
  args+=(--concurrency "$NUTHATCH_CONCURRENCY")
fi

if [[ -n "${NUTHATCH_BACKFILL_BLOCKS:-}" ]]; then
  args+=(--backfill "$NUTHATCH_BACKFILL_BLOCKS")
fi

if [[ -n "${NUTHATCH_RPC_URL:-}" ]]; then
  args+=(--rpc "$NUTHATCH_RPC_URL")
fi

exec nuthatch "${args[@]}"
