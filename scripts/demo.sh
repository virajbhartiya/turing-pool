#!/usr/bin/env bash
# Persistent judge-demo environment. Starts the chain, deploys the stack, and
# keeps the quote API and dashboard alive until Ctrl-C.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ROOT="$PWD"

MODE="${1:-local}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
BASE_RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"
WEB_PORT="${WEB_PORT:-4030}"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/turing-pool-demo.XXXXXX")"

# Foundry's deterministic test accounts #1 and #2. These keys are public,
# local-only fixtures; demo.sh always starts a disposable Anvil chain.
DEMO_BOT_PRIVATE_KEY="${BOT_PRIVATE_KEY:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}"
DEMO_HUMAN_PRIVATE_KEY="${HUMAN_AGENT_PRIVATE_KEY:-0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a}"

ANVIL_PID=""
API_PID=""
WEB_PID=""

cleanup() {
  for pid in "$WEB_PID" "$API_PID" "$ANVIL_PID"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT INT TERM

require_free_port() {
  local port="$1"
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop that process before starting the demo." >&2
    exit 1
  fi
}

require_free_port 8545
require_free_port 4021
require_free_port "$WEB_PORT"

echo "==> Starting Turing Pool in $MODE mode"
if [ "$MODE" = "fork" ]; then
  anvil --port 8545 --fork-url "$BASE_RPC_URL" --silent >"$RUN_DIR/anvil.log" 2>&1 &
else
  anvil --port 8545 --silent >"$RUN_DIR/anvil.log" 2>&1 &
fi
ANVIL_PID=$!

for _ in $(seq 1 30); do
  cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 && break
  sleep 1
done
cast chain-id --rpc-url "$RPC_URL" >/dev/null

if [ "$MODE" = "fork" ]; then
  REAL_AGENT_BOOK=0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4
  REAL_AQUA=0x499943E74FB0cE105688beeE8Ef2ABec5D936d31
  HUMAN_AGENT=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
  SYBIL_AGENT=0x90F79bf6EB2c4f870365E785982E1f101E93b906
  HUMAN_ID_HEX=0x00000000000000000000000000000000000000000000000000000000beefbeef
  HUMAN_ID_DEC=$((16#beefbeef))

  for agent in "$HUMAN_AGENT" "$SYBIL_AGENT"; do
    slot="$(cast index address "$agent" 4)"
    cast rpc anvil_setStorageAt "$REAL_AGENT_BOOK" "$slot" "$HUMAN_ID_HEX" --rpc-url "$RPC_URL" >/dev/null
  done
  (
    cd contracts
    AQUA="$REAL_AQUA" AGENT_BOOK="$REAL_AGENT_BOOK" HUMAN_ID="$HUMAN_ID_DEC" \
      forge script script/DeployDemo.s.sol --rpc-url "$RPC_URL" --broadcast --slow
  ) >"$RUN_DIR/deploy.log"
else
  (
    cd contracts
    forge script script/DeployDemo.s.sol --rpc-url "$RPC_URL" --broadcast --slow
  ) >"$RUN_DIR/deploy.log"
fi

(cd server && exec env \
  DEPLOYMENTS_PATH="$PROJECT_ROOT/contracts/deployments/demo.json" \
  RPC_URL="$RPC_URL" \
  WORLD_RPC_URL="$RPC_URL" \
  CHAIN_ID=31337 \
  AGENTKIT_SIGNER_CHAIN_ID=31337 \
  MARKET_TRADES_ENABLED="${MARKET_TRADES_ENABLED:-1}" \
  MARKET_TRADE_MAX_TETH_IN="${MARKET_TRADE_MAX_TETH_IN:-1000000000000000000}" \
  MARKET_TRADE_MAX_TUSD_IN="${MARKET_TRADE_MAX_TUSD_IN:-1000000000000000000000}" \
  BOT_PRIVATE_KEY="$DEMO_BOT_PRIVATE_KEY" \
  HUMAN_AGENT_PRIVATE_KEY="$DEMO_HUMAN_PRIVATE_KEY" \
  pnpm start) >"$RUN_DIR/server.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 30); do
  curl -sf http://localhost:4021/ >/dev/null 2>&1 && break
  sleep 1
done
curl -sf http://localhost:4021/ >/dev/null

(cd web && exec pnpm dev --port "$WEB_PORT" --strictPort) >"$RUN_DIR/web.log" 2>&1 &
WEB_PID=$!
for _ in $(seq 1 30); do
  curl -sf "http://localhost:$WEB_PORT/" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://localhost:$WEB_PORT/" >/dev/null

echo
echo "Turing Pool is ready:"
echo "  Dashboard: http://localhost:$WEB_PORT"
echo "  Autopilot: http://localhost:$WEB_PORT/#autopilot"
echo "  Quote API: http://localhost:4021"
echo "  Chain:     $MODE (chain id $(cast chain-id --rpc-url "$RPC_URL"))"
echo
echo "Open Autopilot and click 'Run live judge demo' for the complete flow."
echo "For the narrated terminal sequence, run: pnpm demo:beats"
echo
echo "Logs are in $RUN_DIR. Press Ctrl-C to stop the environment."

wait "$ANVIL_PID"
