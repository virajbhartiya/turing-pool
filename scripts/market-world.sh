#!/usr/bin/env bash
# Executes the two judge-facing World Chain trades through the same API used by
# the dashboard. Private keys remain server-side and are never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

API_URL="${API_URL:-http://localhost:4021}"
ORIGIN="${MARKET_TRADE_ORIGIN:-$API_URL}"
AMOUNT_IN="${AMOUNT_IN:-100000000000000000}" # executed notional; try 1e18 to move fees 10× more

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_command curl
require_command jq
require_command cast

state_before="$(curl -sf "$API_URL/state")"
jq -e '
  .runtime.chainId == 480 and
  .runtime.mode == "chain" and
  .contracts.mockAgentBook == false and
  .execution.enabled == true and
  .execution.opcode == 34 and
  .execution.event == "HumanGated"
' <<<"$state_before" >/dev/null
volume_before="$(jq -r '.feeController.tightVolume + \":\" + .feeController.wideVolume' <<<"$state_before")"

deployment_file="${DEPLOYMENTS_PATH:-$PWD/contracts/deployments/world-mainnet.json}"
router="$(jq -r .router "$deployment_file")"
aqua="$(jq -r .aqua "$deployment_file")"
maker="$(jq -r .maker "$deployment_file")"
order_traits="$(jq -r .orderTraits "$deployment_file")"
order_data="$(jq -r .orderData "$deployment_file")"
order_hash="$(jq -r .orderHash "$deployment_file")"
token_in="$(jq -r .tETH "$deployment_file")"
token_out="$(jq -r .tUSD "$deployment_file")"
human_wallet="$(jq -r .humanAgent "$deployment_file")"
bot_wallet="$(jq -r .bot "$deployment_file")"
rpc_url="${RPC_URL:-https://worldchain-mainnet.g.alchemy.com/public}"
taker_data="0x00000000000000000000000000000000000000000041"

router_quote_out() {
  local taker="$1"
  cast call \
    "$router" \
    'quote((address,uint256,bytes),address,address,uint256,bytes)(uint256,uint256,bytes32)' \
    "($maker,$order_traits,$order_data)" \
    "$token_in" \
    "$token_out" \
    "$AMOUNT_IN" \
    "$taker_data" \
    --from "$taker" \
    --rpc-url "$rpc_url" |
    sed -n '2s/ .*//p'
}

quotes_before="$(curl -sf "$API_URL/market/quotes?amountIn=$AMOUNT_IN")"
expected_bot_out="$(router_quote_out "$bot_wallet")"
expected_human_out="$(router_quote_out "$human_wallet")"
jq -e \
  --arg bot "$expected_bot_out" \
  --arg human "$expected_human_out" \
  '.bot.amountOut == $bot and .human.amountOut == $human' \
  <<<"$quotes_before" >/dev/null

read -r router_balance0 _ <<<"$(cast call \
  "$aqua" \
  'safeBalances(address,address,bytes32,address,address)(uint256,uint256)' \
  "$maker" \
  "$router" \
  "$order_hash" \
  "$token_in" \
  "$token_out" \
  --rpc-url "$rpc_url" |
  sed -n '1p')"
router_balance1="$(cast call \
  "$aqua" \
  'safeBalances(address,address,bytes32,address,address)(uint256,uint256)' \
  "$maker" \
  "$router" \
  "$order_hash" \
  "$token_in" \
  "$token_out" \
  --rpc-url "$rpc_url" |
  sed -n '2s/ .*//p')"
jq -e \
  --arg balance0 "$router_balance0" \
  --arg balance1 "$router_balance1" \
  '.pool.balance0 == $balance0 and .pool.balance1 == $balance1' \
  <<<"$state_before" >/dev/null

trade() {
  local lane="$1"
  curl -sf \
    -X POST "$API_URL/market/trade" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    --data "{\"lane\":\"$lane\",\"amountIn\":\"$AMOUNT_IN\"}"
}

echo "1. Anonymous bot → _humanGate opcode 34 → WIDE"
bot="$(trade bot)"
jq -e '
  .lane == "bot" and
  .opcode == 34 and
  .event == "HumanGated" and
  .humanBacked == false and
  .humanId == "0" and
  .tier == "wide"
' <<<"$bot" >/dev/null
jq '{wallet, tier, feeBps, humanId, transactionHash, explorerUrl}' <<<"$bot"

echo
echo "2. World-verified wallet → canonical AgentBook → TIGHT"
human="$(trade human)"
jq -e '
  .lane == "human" and
  .opcode == 34 and
  .event == "HumanGated" and
  .humanBacked == true and
  .humanId != "0" and
  .tier == "tight"
' <<<"$human" >/dev/null
jq '{wallet, tier, feeBps, humanId, transactionHash, explorerUrl}' <<<"$human"

bot_tx="$(jq -r .transactionHash <<<"$bot")"
human_tx="$(jq -r .transactionHash <<<"$human")"

echo
echo "3. Nuthatch follows the receipts → correlated SQL activity"
state_after=""
for _ in {1..15}; do
  state_after="$(curl -sf "$API_URL/state")"
  if jq -e --arg bot "$bot_tx" --arg human "$human_tx" '
    any(.swaps[]; .transactionHash == $bot and .source == "swapvm" and .tight == false) and
    any(.swaps[]; .transactionHash == $human and .source == "swapvm" and .tight == true)
  ' <<<"$state_after" >/dev/null; then
    break
  fi
  sleep 2
done
jq -e --arg bot "$bot_tx" --arg human "$human_tx" '
  any(.swaps[]; .transactionHash == $bot and .source == "swapvm" and .tight == false) and
  any(.swaps[]; .transactionHash == $human and .source == "swapvm" and .tight == true)
' <<<"$state_after" >/dev/null
if jq -e '.dataSources.activity.mode == "sql+mcp"' <<<"$state_after" >/dev/null; then
  jq -e '
    .dataSources.activity.status == "connected" and
    .dataSources.activity.name == "Nuthatch · SQL + MCP" and
    .dataSources.activity.registryHash != null and
    .dataSources.activity.summary.tightFills >= 1 and
    .dataSources.activity.summary.wideFills >= 1
  ' <<<"$state_after" >/dev/null
  jq '{
    indexer: .dataSources.activity.name,
    indexedBlock: .dataSources.activity.indexedBlock,
    lagBlocks: .dataSources.activity.lagBlocks,
    registryHash: .dataSources.activity.registryHash,
    activity: .dataSources.activity.summary
  }' <<<"$state_after"
else
  echo "Nuthatch is not configured; direct World Chain event fallback verified."
fi
jq -e --arg amount "$AMOUNT_IN" --arg before "$volume_before" '
  (.feeController.tightVolume + ":" + .feeController.wideVolume) != $before and
  (.feeController.normalization | contains("on-chain")) and
  (.feeController.source == "on-chain-volume-controller") and
  (.feeController.tightVolume | tonumber) >= ($amount | tonumber) and
  (.feeController.wideVolume | tonumber) >= ($amount | tonumber)
' <<<"$state_after" >/dev/null

echo
echo "WORLD CHAIN PROOF COMPLETE"
printf 'Executed volume: human %s tETH · bot %s tETH\n' \
  "$(jq -r '.feeController.tightVolume | tonumber / 1e18' <<<"$state_after")" \
  "$(jq -r '.feeController.wideVolume | tonumber / 1e18' <<<"$state_after")"
printf 'Anonymous: %s\n' "$(jq -r .explorerUrl <<<"$bot")"
printf 'Verified:  %s\n' "$(jq -r .explorerUrl <<<"$human")"
printf 'Dashboard: %s\n' "$API_URL"
