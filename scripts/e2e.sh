#!/usr/bin/env bash
# Turing Pool end-to-end demo test.
#
#   ./scripts/e2e.sh          local mode: fresh anvil, local Aqua + MockAgentBook
#   ./scripts/e2e.sh fork     fork mode:  anvil fork of Base mainnet, REAL 1inch Aqua
#                             + REAL World AgentBook (demo agents registered into the
#                             real registry's storage via anvil_setStorageAt)
#
# Asserts, end to end: bot pays wide fee; human-backed agent (full AgentKit
# 402->SIWE->verify loop) pays tight fee; sybil wallet of the same human shares
# the quota; Autopilot compiles a bounded strategy from market evidence and
# reconciles a real Aqua receipt into its multi-slice position.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ROOT="$PWD"

MODE="${1:-local}"
RPC_PORT="${E2E_RPC_PORT:-8545}"
API_PORT="${E2E_API_PORT:-4021}"
RPC="http://127.0.0.1:$RPC_PORT"
API="http://localhost:$API_PORT"
BASE_RPC="${BASE_RPC_URL:-https://mainnet.base.org}"
REAL_AQUA=0x499943E74FB0cE105688beeE8Ef2ABec5D936d31
REAL_AGENT_BOOK=0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4
HUMAN_AGENT=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
SYBIL_AGENT=0x90F79bf6EB2c4f870365E785982E1f101E93b906
HUMAN_ID_HEX=0x00000000000000000000000000000000000000000000000000000000beefbeef
HUMAN_ID_DEC=$((16#beefbeef))

export DEPLOYMENTS_PATH="$PROJECT_ROOT/contracts/deployments/demo.json"
export RPC_URL="$RPC"
export API_URL="$API"
export CHAIN_ID=31337
export AGENTKIT_SIGNER_CHAIN_ID=31337

pass=0; fail=0
ANVIL_PID=""
API_PID=""
check() { # check <name> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "  ✓ $1"; pass=$((pass+1));
  else echo "  ✗ $1 (got '$2', want '$3')"; fail=$((fail+1)); fi
}
check_gt() { # check_gt <name> <a> <b>  (asserts a > b, big-int safe)
  if python3 -c "import sys; sys.exit(0 if int('$2') > int('$3') else 1)"; then
    echo "  ✓ $1"; pass=$((pass+1));
  else echo "  ✗ $1 ($2 <= $3)"; fail=$((fail+1)); fi
}

cleanup() {
  for pid in "$API_PID" "$ANVIL_PID"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

for port in "$RPC_PORT" "$API_PORT"; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop that process before running E2E." >&2
    exit 1
  fi
done

echo "==> [1/8] starting anvil ($MODE mode)"
if [ "$MODE" = "fork" ]; then
  anvil --port "$RPC_PORT" --fork-url "$BASE_RPC" --silent &
else
  anvil --port "$RPC_PORT" --silent &
fi
ANVIL_PID=$!
for i in $(seq 1 30); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 1; done
cast chain-id --rpc-url $RPC >/dev/null

echo "==> [2/8] deploying Turing Pool stack"
cd contracts
if [ "$MODE" = "fork" ]; then
  # Register our demo agents in the REAL AgentBook's storage on the fork
  # (lookupHuman mapping lives at slot 4 - validated by TuringPoolForkTest).
  for agent in $HUMAN_AGENT $SYBIL_AGENT; do
    slot=$(cast index address "$agent" 4)
    cast rpc anvil_setStorageAt "$REAL_AGENT_BOOK" "$slot" "$HUMAN_ID_HEX" --rpc-url $RPC >/dev/null
  done
  registered=$(cast call $REAL_AGENT_BOOK "lookupHuman(address)(uint256)" $HUMAN_AGENT --rpc-url $RPC)
  echo "    real AgentBook now maps humanAgent -> ${registered%% *}"
  AQUA=$REAL_AQUA AGENT_BOOK=$REAL_AGENT_BOOK HUMAN_ID=$HUMAN_ID_DEC \
    forge script script/DeployDemo.s.sol --rpc-url $RPC --broadcast --slow >/dev/null
else
  forge script script/DeployDemo.s.sol --rpc-url $RPC --broadcast --slow >/dev/null
fi
cd ..
echo "    deployed: $(python3 -c "import json;d=json.load(open('contracts/deployments/demo.json'));print('app',d['app'],'| aqua',d['aqua'],'| agentBook',d['agentBook'],'(mock)' if d['mockAgentBook'] else '(REAL)')")"

echo "==> [3/8] starting quote API"
(cd server && exec env \
  DEPLOYMENTS_PATH="$PROJECT_ROOT/contracts/deployments/demo.json" \
  RPC_URL="$RPC" \
  WORLD_RPC_URL="$RPC" \
  CHAIN_ID=31337 \
  PORT="$API_PORT" \
  AGENTKIT_SIGNER_CHAIN_ID=31337 \
  AUTOPILOT_STORE_PATH="$PROJECT_ROOT/.data/autopilot-e2e-$$.json" \
  MARKET_TRADE_MAX_AMOUNT_IN=10000000000000000000 \
  pnpm start) > /tmp/turing-e2e-server.log 2>&1 &
API_PID=$!
for i in $(seq 1 30); do curl -sf $API/ >/dev/null 2>&1 && break; sleep 1; done
curl -sf $API/ >/dev/null

challenge=$(curl -s -o /dev/null -w '%{http_code}' "$API/quote?amountIn=1000000000000000000")
check "unauthenticated /quote returns 402 AgentKit challenge" "$challenge" "402"
fresh_market_status=$(curl -s -o /tmp/turing-e2e-fresh-market.json -w '%{http_code}' \
  "$API/market/quotes?amountIn=100000000000000000")
check "fresh dashboard market comparison loads before any trades" "$fresh_market_status" "200"

echo "==> [4/8] BOT swaps (anonymous lane)"
bot_json=$(cd agent && pnpm --silent bot 2>&1 | tail -1)
check "bot tier" "$(echo "$bot_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tier"])')" "wide"

echo "==> [5/8] CUSTOM SWAPVM ROUTER executes _humanGate opcode"
set +e
router_json=$(cd agent && pnpm --silent router 2>&1 | tail -1)
router_status=$?
set -e
if [ "$router_status" -eq 0 ]; then
  check "router humanGate opcode" "$(echo "$router_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["opcode"])')" "34"
  check "router emits HumanGated" "$(echo "$router_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["event"])')" "HumanGated"
else
  echo "  ✗ router demo command failed"; fail=$((fail+1))
fi

echo "==> [6/8] HUMAN-BACKED AGENT swaps (AgentKit 402->SIWE->verify loop) + sybil test"
human_json=$(cd agent && pnpm --silent human 2>&1 | tail -1)
check "human tier" "$(echo "$human_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tier"])')" "tight"
check "sybil over-cap tier" "$(echo "$human_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["sybilTier"])')" "wide"
human_out=$(echo "$human_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["amountOut"])')
same_state_wide_out=$(echo "$human_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["wideAmountOut"])')
check_gt "human quote beats wide tier at the same pool state" "$human_out" "$same_state_wide_out"
dashboard_quotes=$(curl -s "$API/market/quotes?amountIn=100000000000000000")
dashboard_sybil=$(echo "$dashboard_quotes" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("sybil", {}).get("tier", "missing"))')
check "dashboard reproduces over-cap sybil tier" "$dashboard_sybil" "wide"
if [ "$dashboard_sybil" = "missing" ]; then
  echo "    market quote response: $(echo "$dashboard_quotes" | python3 -c 'import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ("code", "error", "status")})')"
fi

echo "==> [7/8] AUTOPILOT compiles and activates a bounded strategy"
plan=$(curl -sf -X POST "$API/autopilot/plan" \
  -H 'content-type: application/json' \
  --data "{\"prompt\":\"Convert 0.01 tETH to tUSD in 5 slices when bot activity is below 95% and fee is under 100 bps.\",\"owner\":\"$HUMAN_AGENT\",\"maxPriceGapBps\":2000}")
plan_id=$(echo "$plan" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
check "Autopilot identity check" "$(echo "$plan" | python3 -c 'import json,sys;p=json.load(sys.stdin);print(next(c["passed"] for c in p["checks"] if c["key"]=="identity"))')" "True"
check "Autopilot evidence check" "$(echo "$plan" | python3 -c 'import json,sys;p=json.load(sys.stdin);print(next(c["passed"] for c in p["checks"] if c["key"]=="indexer"))')" "True"
active=$(curl -sf -X POST "$API/autopilot/$plan_id/activate" -H 'content-type: application/json' --data '{}')
check "Autopilot status" "$(echo "$active" | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])')" "active"
active_decision=$(echo "$active" | python3 -c 'import json,sys;print(json.load(sys.stdin)["decision"])')
check "Autopilot decision" "$active_decision" "execute"
if [ "$active_decision" != "execute" ]; then
  echo "    $(echo "$active" | python3 -c 'import json,sys;p=json.load(sys.stdin);print(p["decisionSummary"], [(c["key"], c["value"], c["limit"]) for c in p["checks"] if not c["passed"]])')"
fi

echo "==> [8/8] AUTOPILOT executes all five prepared Aqua slices and rejects fake/replayed progress"
confirmed=$(cd server && pnpm exec tsx ../scripts/autopilot-e2e.ts "$plan_id" | tail -1)
check "Autopilot completed slices" "$(echo "$confirmed" | python3 -c 'import json,sys;print(json.load(sys.stdin)["executedSlices"])')" "5"
check "Autopilot receipt binding" "$(echo "$confirmed" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["executions"]))')" "5"
check_gt "human price improvement remains positive (bps)" "$(echo "$dashboard_quotes" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("improvementBps", 0))')" "0"

echo
echo "================================================"
echo " E2E ($MODE): $pass passed, $fail failed"
[ "$MODE" = "fork" ] && echo " (real 1inch Aqua + real World AgentBook bytecode)"
echo "================================================"
exit $fail
