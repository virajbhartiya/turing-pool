#!/usr/bin/env bash
# Live World Chain reads and wallet-signed transactions. No server trading keys.
set -euo pipefail
cd "$(dirname "$0")/.."

export RPC_URL="${RPC_URL:-https://worldchain-mainnet.g.alchemy.com/public}"
export WORLD_RPC_URL="$RPC_URL"
export CHAIN_ID=480
export AGENTKIT_SIGNER_CHAIN_ID=480
export PORT=4021
export HOST=127.0.0.1
export DEPLOYMENTS_PATH="$PWD/contracts/deployments/world-mainnet.json"
export NUTHATCH_URL="${NUTHATCH_URL:-http://127.0.0.1:8288}"
export AUTOPILOT_STORE_PATH="$PWD/.data/autopilot-world.json"
export MARKET_TRADES_ENABLED=0
unset HOSTED_DEMO_MODE DEPLOYMENTS_JSON BOT_PRIVATE_KEY HUMAN_AGENT_PRIVATE_KEY

for port in 4021 4030; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already occupied. Stop the existing project service first." >&2
    exit 1
  fi
done

pids=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]}"; do
    # Terminate this launcher's descendants only, including package-manager children.
    stop_tree "$pid"
  done
}
stop_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" || true); do stop_tree "$child"; done
  kill -TERM "$pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! curl -fsS --max-time 3 "$NUTHATCH_URL/health" >/dev/null 2>&1; then
  if lsof -nP -iTCP:8288 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Using existing indexer listener on 8288; /state will report its readiness."
  else
    NUTHATCH_RPC_URL="${NUTHATCH_RPC_URL:-https://worldchain-mainnet.gateway.tenderly.co}" NUTHATCH_LOG_WINDOW=100000 NUTHATCH_SEAL_DIRECT=1 NUTHATCH_CONCURRENCY=4 pnpm nuthatch:dev &
    pids+=("$!")
  fi
fi
pnpm --filter @turing-pool/server start &
pids+=("$!")
pnpm --filter @turing-pool/web dev --host 127.0.0.1 --port 4030 &
pids+=("$!")
echo "Live interface: http://localhost:4030 — wallet approvals required; native ETH pays gas."
wait
