#!/usr/bin/env bash
# Runs the judge-facing proof against the public Base Sepolia deployment.
# Private keys are loaded from environment variables or encrypted Foundry
# keystores backed by macOS Keychain entries. They are never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

API_URL="${API_URL:-http://localhost:4021}"
RPC_URL="${RPC_URL:-https://base-sepolia-rpc.publicnode.com}"
CHAIN_ID=84532
DEPLOYMENTS_PATH="${DEPLOYMENTS_PATH:-$PWD/contracts/deployments/base-sepolia.json}"
AMOUNT_IN="${AMOUNT_IN:-100000000000000000}" # 0.1 tETH per executable beat
EXPLORER_URL="${EXPLORER_URL:-https://sepolia.basescan.org}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

load_keystore_key() {
  local account_name="$1"
  local keychain_service="$2"
  local account_password

  require_command cast
  require_command security
  account_password="$(security find-generic-password -w -s "$keychain_service")"
  cast wallet private-key --account "$account_name" --password "$account_password"
}

require_command curl
require_command jq
require_command node
require_command pnpm

curl -sf "$API_URL/health" >/dev/null || {
  echo "The live quote API is not running at $API_URL." >&2
  echo "Start it with the Base Sepolia command in docs/DEMO.md, then retry." >&2
  exit 1
}

state_before="$(curl -sf "$API_URL/state")"
runtime_chain="$(jq -r '.runtime.chainId' <<<"$state_before")"
runtime_mode="$(jq -r '.runtime.mode' <<<"$state_before")"
if [ "$runtime_chain" != "$CHAIN_ID" ] || [ "$runtime_mode" != "chain" ]; then
  echo "Refusing to present a non-testnet runtime as the Base Sepolia demo." >&2
  echo "Observed mode=$runtime_mode chain=$runtime_chain" >&2
  exit 1
fi

BOT_PRIVATE_KEY="${BOT_PRIVATE_KEY:-$(load_keystore_key \
  turing-pool-base-sepolia-bot dev.turing-pool.base-sepolia-bot)}"
MAKER_PRIVATE_KEY="${MAKER_PRIVATE_KEY:-$(load_keystore_key \
  turing-pool-base-sepolia dev.turing-pool.base-sepolia-deployer)}"
HUMAN_AGENT_PRIVATE_KEY="${HUMAN_AGENT_PRIVATE_KEY:-$(load_keystore_key \
  turing-pool-base-sepolia-human dev.turing-pool.base-sepolia-human)}"
SYBIL_AGENT_PRIVATE_KEY="${SYBIL_AGENT_PRIVATE_KEY:-$(load_keystore_key \
  turing-pool-base-sepolia-sybil dev.turing-pool.base-sepolia-sybil)}"

run_agent() {
  local title="$1"
  shift
  echo
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "$title"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  env \
    API_URL="$API_URL" \
    RPC_URL="$RPC_URL" \
    CHAIN_ID="$CHAIN_ID" \
    DEPLOYMENTS_PATH="$DEPLOYMENTS_PATH" \
    AMOUNT_IN="$AMOUNT_IN" \
    "$@"
}

bot_output="$(run_agent \
  "1. Anonymous agent: 402 challenge → wide lane → Base Sepolia swap" \
  BOT_PRIVATE_KEY="$BOT_PRIVATE_KEY" \
  pnpm --dir agent --silent bot)"
printf '%s\n' "$bot_output"
bot_json="$(tail -n 1 <<<"$bot_output")"

human_output="$(run_agent \
  "2. AgentKit: SIWE proof → tight lane; sybil wallet inherits shared cap" \
  HUMAN_AGENT_PRIVATE_KEY="$HUMAN_AGENT_PRIVATE_KEY" \
  SYBIL_AGENT_PRIVATE_KEY="$SYBIL_AGENT_PRIVATE_KEY" \
  pnpm --dir agent --silent human)"
printf '%s\n' "$human_output"
human_json="$(tail -n 1 <<<"$human_output")"

router_output="$(run_agent \
  "3. SwapVM: _humanGate opcode 34 → HumanGated event → XYC swap" \
  HUMAN_AGENT_PRIVATE_KEY="$HUMAN_AGENT_PRIVATE_KEY" \
  pnpm --dir agent --silent router)"
printf '%s\n' "$router_output"
router_json="$(tail -n 1 <<<"$router_output")"

jq -e '.tier == "wide"' <<<"$bot_json" >/dev/null
jq -e '.tier == "tight" and .sybilTier == "wide"' \
  <<<"$human_json" >/dev/null
jq -e '.opcode == 34 and .event == "HumanGated"' <<<"$router_json" >/dev/null

wide_before="$(jq -r '.stats.wideSwaps' <<<"$state_before")"
tight_before="$(jq -r '.stats.tightSwaps' <<<"$state_before")"
state_after="$state_before"
for _ in $(seq 1 15); do
  state_after="$(curl -sf "$API_URL/state")"
  wide_after="$(jq -r '.stats.wideSwaps' <<<"$state_after")"
  tight_after="$(jq -r '.stats.tightSwaps' <<<"$state_after")"
  if [ "$wide_after" -gt "$wide_before" ] && [ "$tight_after" -gt "$tight_before" ]; then
    break
  fi
  sleep 1
done

if [ "$wide_after" -le "$wide_before" ] || [ "$tight_after" -le "$tight_before" ]; then
  echo "Fresh wide and tight settlements did not appear in the live dashboard state." >&2
  exit 1
fi

strategist_output="$(run_agent \
  "4. Activity controller: retail fee ↓ + bot surcharge ↑ → LP target unchanged" \
  MAKER_PRIVATE_KEY="$MAKER_PRIVATE_KEY" \
  ALLOW_CHAIN_EVENT_FALLBACK=1 \
  pnpm --dir agent --silent strategist)"
printf '%s\n' "$strategist_output"
strategist_json="$(tail -n 1 <<<"$strategist_output")"
jq -e '
  .role == "strategist" and
  .to.tight < .to.wide and
  .targetBlendedFeeBps == 19 and
  .revenueDeltaBps >= -0.5 and
  .revenueDeltaBps <= 0.5
' <<<"$strategist_json" >/dev/null

expected_tight="$(jq -r '.to.tight' <<<"$strategist_json")"
expected_wide="$(jq -r '.to.wide' <<<"$strategist_json")"
for _ in $(seq 1 15); do
  state_after="$(curl -sf "$API_URL/state")"
  active_tight="$(jq -r '.pool.tightFeeBps' <<<"$state_after")"
  active_wide="$(jq -r '.pool.wideFeeBps' <<<"$state_after")"
  if [ "$active_tight" = "$expected_tight" ] && [ "$active_wide" = "$expected_wide" ]; then
    break
  fi
  sleep 1
done
if [ "$active_tight" != "$expected_tight" ] || [ "$active_wide" != "$expected_wide" ]; then
  echo "The re-priced Aqua strategy did not become active in dashboard state." >&2
  exit 1
fi

quotes_after="$(curl -sf "$API_URL/demo/quotes")"
jq -e '
  .human.tier == "tight" and
  .bot.tier == "wide" and
  .sybil.tier == "wide"
' <<<"$quotes_after" >/dev/null
node -e '
  const quotes = JSON.parse(process.argv[1]);
  if (BigInt(quotes.sybil.amountIn) !== BigInt(quotes.sybil.sharedQuotaRemaining) + 1n) {
    throw new Error("sybil quote is not exactly one wei over the shared quota");
  }
' "$quotes_after"

bot_address="$(jq -r '.bot | ascii_downcase' "$DEPLOYMENTS_PATH")"
human_address="$(jq -r '.humanAgent | ascii_downcase' "$DEPLOYMENTS_PATH")"
bot_tx="$(jq -r --arg taker "$bot_address" \
  '[.swaps[] | select((.taker | ascii_downcase) == $taker)] | last | .transactionHash' \
  <<<"$state_after")"
human_tx="$(jq -r --arg taker "$human_address" \
  '[.swaps[] | select((.taker | ascii_downcase) == $taker)] | last | .transactionHash' \
  <<<"$state_after")"
router_tx="$(jq -r '.txHash' <<<"$router_json")"
strategist_tx="$(jq -r '.shipTx // empty' <<<"$strategist_json")"
for tx_hash in "$bot_tx" "$human_tx" "$router_tx"; do
  if [[ ! "$tx_hash" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "Could not resolve a fresh proof transaction from live state: $tx_hash" >&2
    exit 1
  fi
done

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PROOF COMPLETE — PUBLIC BASE SEPOLIA"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf 'Dashboard:    %s/\n' "$API_URL"
printf 'Anonymous tx: %s/tx/%s\n' "$EXPLORER_URL" "$bot_tx"
printf 'Human tx:    %s/tx/%s\n' "$EXPLORER_URL" "$human_tx"
printf 'SwapVM tx:   %s/tx/%s\n' "$EXPLORER_URL" "$router_tx"
if [ -n "$strategist_tx" ]; then
  printf 'Re-price tx: %s/tx/%s\n' "$EXPLORER_URL" "$strategist_tx"
else
  printf 'Re-price:    already balanced at %s/%s bps\n' "$expected_tight" "$expected_wide"
fi
printf 'LP target:   19 bps blended · projected %s bps\n' \
  "$(jq -r '.projectedBlendedFeeBps' <<<"$strategist_json")"
printf 'State:       %s/state\n' "$API_URL"
printf 'Quotes:      %s/demo/quotes\n' "$API_URL"
echo
echo "Truth label: public Base Sepolia; test Aqua + test AgentBook contracts."
