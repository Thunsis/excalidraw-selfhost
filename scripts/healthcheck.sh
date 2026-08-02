#!/usr/bin/env bash
# ============================================================
# healthcheck.sh - verify all services are healthy
#
# Silent when healthy (exit 0). Prints issues and exits 1
# when something is wrong. Designed for cron watchdog use.
#
# Usage: ./healthcheck.sh [--external-domain draw.example.com]
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
fi

CADDY_PORT="${CADDY_PORT:-3001}"
WS_PORT="${WS_PORT:-3020}"
AI_PORT="${AI_PORT:-3016}"
DOMAIN="${DOMAIN:-}"
PROBLEMS=()

check_port() {
  local port="$1" name="$2"
  if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN > /dev/null 2>&1; then
    PROBLEMS+=("$name down (port $port)")
  fi
}

check_port "$CADDY_PORT" "caddy"
check_port "$WS_PORT" "ws-backend"
check_port "$AI_PORT" "ai-backend"

# launchd jobs alive?
JOBS=$(launchctl list 2>/dev/null || true)
for job in com.excalidraw.ws-backend com.excalidraw.ai-backend com.excalidraw.caddy; do
  echo "$JOBS" | grep -q "$job" || PROBLEMS+=("launchd job $job not loaded")
done

# DB integrity (if present)
DATA_DIR="${WS_DATA_DIR:-$SCRIPT_DIR/apps/ws-server/data}"
if [[ -f "$DATA_DIR/workspace.db" ]]; then
  if ! sqlite3 "$DATA_DIR/workspace.db" "PRAGMA quick_check;" 2>/dev/null | grep -q "^ok"; then
    PROBLEMS+=("database integrity check failed")
  fi
fi

# external reachability (optional)
if [[ -n "${1:-$DOMAIN}" ]]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${1:-$DOMAIN}/" 2>/dev/null || echo 000)
  [[ "$code" == "200" ]] || PROBLEMS+=("external ${1:-$DOMAIN} returned $code")
fi

if [[ ${#PROBLEMS[@]} -gt 0 ]]; then
  echo "❌ healthcheck failed:"
  printf '   - %s\n' "${PROBLEMS[@]}"
  exit 1
fi

echo "✅ all services healthy"
exit 0
