#!/usr/bin/env bash
# Isolated, continuously active Anvil rehearsal. Never points at a public RPC.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ROOT="$PWD"
RUN_DIR="$PROJECT_ROOT/.data/demo-market"
LOCK_DIR="$RUN_DIR/lock"
mkdir -p "$RUN_DIR"

case "${1:-start}" in
  status)
    if [ -f "$RUN_DIR/status.json" ]; then cat "$RUN_DIR/status.json"; else echo 'Demo activity has not been started.'; fi
    exit 0 ;;
  stop)
    if [ ! -f "$LOCK_DIR/pid" ]; then echo 'Demo environment is not running.'; exit 0; fi
    pid="$(cat "$LOCK_DIR/pid")"
    if ps -p "$pid" -o command= | grep -q 'scripts/demo-market.sh'; then
      kill -TERM "$pid"
      echo 'Stopping demo activity and its isolated services.'
    else echo 'No matching demo process; no signal sent.'; fi
    exit 0 ;;
  start) ;;
  *) echo 'Usage: pnpm demo:market [start|status|stop]' >&2; exit 1 ;;
esac

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -f "$LOCK_DIR/pid" ] && kill -0 "$(cat "$LOCK_DIR/pid")" 2>/dev/null; then
    echo 'Demo environment is already running. Use pnpm demo:market:status.' >&2
    exit 1
  fi
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo "$$" > "$LOCK_DIR/pid"
PIDS=()
stop_tree() {
  local child
  for child in $(pgrep -P "$1" || true); do stop_tree "$child"; done
  kill -TERM "$1" 2>/dev/null || true
}
cleanup() {
  trap - EXIT INT TERM
  # Let the activity process finish a pending receipt before taking down its API.
  if [ -n "${MAKER_PID:-}" ]; then
    kill -TERM "$MAKER_PID" 2>/dev/null || true
    wait "$MAKER_PID" 2>/dev/null || true
  fi
  for pid in "${PIDS[@]}"; do stop_tree "$pid"; done
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM
for port in 8546 4022; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is occupied. The existing service was left untouched." >&2; exit 1
  fi
done
unset DEPLOYMENTS_JSON HOSTED_DEMO_MODE NUTHATCH_URL SUBGRAPH_URL VAULT_FACTORY FAUCET_ADDRESS
unset PRIVATE_KEY AQUA AGENT_BOOK HUMAN_AGENT BOT SYBIL_AGENT HUMAN_ID REQUIRE_REAL_AGENT_BOOK NODE_ENV
pnpm --filter @turing-pool/web build > "$RUN_DIR/build.log" 2>&1
anvil --host 127.0.0.1 --port 8546 --chain-id 31337 --silent > "$RUN_DIR/anvil.log" 2>&1 &
PIDS+=("$!")
for _ in $(seq 1 30); do
  if cast chain-id --rpc-url http://127.0.0.1:8546 >/dev/null 2>&1; then break; fi
  sleep 1
done
[ "$(cast chain-id --rpc-url http://127.0.0.1:8546)" = 31337 ]
if [ -f "$RUN_DIR/strategies.json" ]; then
  mv "$RUN_DIR/strategies.json" "$RUN_DIR/strategies-$(date +%Y%m%dT%H%M%S).json"
fi
(
  cd contracts
  DEPLOYMENTS_FILE=./deployments/demo-market.json forge script script/DeployDemo.s.sol --rpc-url http://127.0.0.1:8546 --broadcast --slow
) > "$RUN_DIR/deploy.log" 2>&1
(
  cd contracts
  forge script script/DeployDemoExtras.s.sol --rpc-url http://127.0.0.1:8546 --broadcast --slow
) >> "$RUN_DIR/deploy.log" 2>&1
(
  cd server
  exec env HOST=127.0.0.1 PORT=4022 \
    DEPLOYMENTS_PATH="$PROJECT_ROOT/contracts/deployments/demo-market.json" \
    RPC_URL=http://127.0.0.1:8546 WORLD_RPC_URL=http://127.0.0.1:8546 \
    CHAIN_ID=31337 AGENTKIT_SIGNER_CHAIN_ID=31337 AGENTKIT_SIGNER_RPC_URL=http://127.0.0.1:8546 \
    BASE_URL=http://127.0.0.1:4022 SERVER_DOMAIN=127.0.0.1 \
    AUTOPILOT_STORE_PATH="$RUN_DIR/strategies.json" \
    MARKET_TRADES_ENABLED=1 MARKET_TRADE_ORIGIN=http://127.0.0.1:4022 \
    MARKET_TRADE_MAX_TETH_IN=1000000000000000000 MARKET_TRADE_MAX_TUSD_IN=1000000000000000000000 \
    BOT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
    HUMAN_AGENT_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a \
    pnpm start
) > "$RUN_DIR/server.log" 2>&1 &
PIDS+=("$!")
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4022/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:4022/health >/dev/null
node scripts/demo-market-maker.mjs > "$RUN_DIR/activity.log" 2>&1 &
MAKER_PID=$!
echo 'Active sandbox: http://127.0.0.1:4022/#autopilot'
echo 'Mined demo activity every ~8 seconds, for up to 12 hours.'
echo 'Status: pnpm demo:market:status | Stop: pnpm demo:market:stop'
echo "Logs: $RUN_DIR/activity.log"
wait "$MAKER_PID"
