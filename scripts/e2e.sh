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
# the quota; the strategist agent autonomously re-prices via Aqua dock+ship.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-local}"
RPC=http://127.0.0.1:8545
API=http://localhost:4021
BASE_RPC="${BASE_RPC_URL:-https://mainnet.base.org}"
REAL_AQUA=0x499943E74FB0cE105688beeE8Ef2ABec5D936d31
REAL_AGENT_BOOK=0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4
HUMAN_AGENT=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
SYBIL_AGENT=0x90F79bf6EB2c4f870365E785982E1f101E93b906
HUMAN_ID_HEX=0x00000000000000000000000000000000000000000000000000000000beefbeef
HUMAN_ID_DEC=$((16#beefbeef))

pass=0; fail=0
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
  kill "$(lsof -ti :4021)" 2>/dev/null || true
  pkill -f 'anvil --port 8545' 2>/dev/null || true
}
trap cleanup EXIT
cleanup; sleep 1

echo "==> [1/7] starting anvil ($MODE mode)"
if [ "$MODE" = "fork" ]; then
  anvil --port 8545 --fork-url "$BASE_RPC" --silent &
else
  anvil --port 8545 --silent &
fi
for i in $(seq 1 30); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 1; done
cast chain-id --rpc-url $RPC >/dev/null

echo "==> [2/7] deploying Turing Pool stack"
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
    forge script script/DeployDemo.s.sol --rpc-url $RPC --broadcast >/dev/null
else
  forge script script/DeployDemo.s.sol --rpc-url $RPC --broadcast >/dev/null
fi
cd ..
echo "    deployed: $(python3 -c "import json;d=json.load(open('contracts/deployments/demo.json'));print('app',d['app'],'| aqua',d['aqua'],'| agentBook',d['agentBook'],'(mock)' if d['mockAgentBook'] else '(REAL)')")"

echo "==> [3/7] starting quote API"
(cd server && nohup pnpm start > /tmp/turing-e2e-server.log 2>&1 &)
for i in $(seq 1 30); do curl -sf $API/ >/dev/null 2>&1 && break; sleep 1; done
curl -sf $API/ >/dev/null

challenge=$(curl -s -o /dev/null -w '%{http_code}' "$API/quote?amountIn=1000000000000000000")
check "unauthenticated /quote returns 402 AgentKit challenge" "$challenge" "402"

echo "==> [4/7] BOT swaps (anonymous lane)"
bot_json=$(cd agent && pnpm --silent bot 2>&1 | tail -1)
check "bot tier" "$(echo "$bot_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tier"])')" "wide"
bot_out=$(echo "$bot_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["amountOut"])')

echo "==> [5/7] HUMAN-BACKED AGENT swaps (AgentKit 402->SIWE->verify loop) + sybil test"
human_json=$(cd agent && pnpm --silent human 2>&1 | tail -1)
check "human tier" "$(echo "$human_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tier"])')" "tight"
check "sybil over-cap tier" "$(echo "$human_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["sybilTier"])')" "wide"
human_out=$(echo "$human_json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["amountOut"])')
check_gt "human receives more than bot for the same input" "$human_out" "$bot_out"

echo "==> [6/7] STRATEGIST re-prices from live flow data (dock + ship on Aqua)"
fees_before=$(curl -s $API/state | python3 -c 'import json,sys;p=json.load(sys.stdin)["pool"];print(p["tightFeeBps"],p["wideFeeBps"])')
(cd agent && ANTHROPIC_API_KEY= pnpm --silent strategist > /tmp/turing-e2e-strategist.log 2>&1)
fees_after=$(curl -s $API/state | python3 -c 'import json,sys;p=json.load(sys.stdin)["pool"];print(p["tightFeeBps"],p["wideFeeBps"])')
if [ "$fees_before" != "$fees_after" ]; then
  echo "  ✓ strategist re-priced: [$fees_before] -> [$fees_after] bps"; pass=$((pass+1))
else
  echo "  ✗ strategist did not re-price (still $fees_after)"; fail=$((fail+1))
fi

echo "==> [7/7] post-repricing quotes"
improv=$(curl -s "$API/demo/quotes" | python3 -c 'import json,sys;print(json.load(sys.stdin)["improvementBps"])')
check_gt "human price improvement after re-pricing (bps)" "$improv" "0"
tier_now=$(curl -s "$API/demo/quotes" | python3 -c 'import json,sys;print(json.load(sys.stdin)["human"]["tier"])')
check "human still tight-tier on re-shipped strategy" "$tier_now" "tight"

echo
echo "================================================"
echo " E2E ($MODE): $pass passed, $fail failed"
[ "$MODE" = "fork" ] && echo " (real 1inch Aqua + real World AgentBook bytecode)"
echo "================================================"
exit $fail
