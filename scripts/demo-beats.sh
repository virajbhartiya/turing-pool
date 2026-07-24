#!/usr/bin/env bash
# Runs the four judge-demo beats against an already-running `pnpm demo`.
set -euo pipefail
cd "$(dirname "$0")/.."

API_URL="${API_URL:-http://localhost:4021}"
PAUSE_SECONDS="${PAUSE_SECONDS:-2}"

curl -sf "$API_URL/" >/dev/null || {
  echo "Quote API is not running. Start `pnpm demo` or `pnpm demo:fork` first." >&2
  exit 1
}

if [ -z "${SUBGRAPH_URL:-}" ] && [ "${ALLOW_API_FALLBACK:-}" != "1" ]; then
  echo "SUBGRAPH_URL is required for the judged demo so The Graph remains load-bearing." >&2
  echo "For local rehearsal only, set ALLOW_API_FALLBACK=1." >&2
  exit 1
fi

beat() {
  local title="$1"
  shift
  echo
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "$title"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  "$@"
  sleep "$PAUSE_SECONDS"
}

beat "1. Anonymous bot receives the wide lane" \
  pnpm --dir agent --silent bot

beat "2. Personhood executes inside SwapVM as opcode 34" \
  pnpm --dir agent --silent router

beat "3. AgentKit proves human backing; a second wallet cannot reset quota" \
  pnpm --dir agent --silent human

beat "4. Graph-grounded strategist docks and re-ships tighter pricing" \
  env SUBGRAPH_URL="${SUBGRAPH_URL:-}" pnpm --dir agent --silent strategist

echo
echo "Demo complete. Final live state:"
curl -sf "$API_URL/state"
echo
