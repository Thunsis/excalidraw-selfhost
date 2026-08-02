#!/usr/bin/env bash
# ============================================================
# build-frontend.sh - single-source frontend build
#
# The excalidraw repo stays pristine (0 uncommitted changes).
# This script: restore -> apply patches -> build -> restore.
#
# Usage:
#   ./build-frontend.sh /path/to/excalidraw          # default: build
#   ./build-frontend.sh /path/to/excalidraw --apply  # patch only (dev)
#   ./build-frontend.sh /path/to/excalidraw --keep   # build, keep patches applied
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:?usage: ./build-frontend.sh /path/to/excalidraw [--apply|--keep]}"
MODE="${2:-default}"

if [[ ! -d "$TARGET/.git" ]]; then
  echo "ERROR: $TARGET is not a git repo"
  exit 1
fi

cd "$TARGET"

if [[ "$MODE" == "--apply" ]]; then
  "$SCRIPT_DIR/apply-patch.sh" "$TARGET"
  exit 0
fi

echo "== 1/4 restore upstream =="
git checkout -- . && git clean -fd > /dev/null 2>&1 || true

echo "== 2/4 apply patches =="
"$SCRIPT_DIR/apply-patch.sh" "$TARGET"

echo "== 3/4 build =="
# corepack yarn: yarn not on PATH, must use corepack (PATH includes /opt/homebrew/bin)
corepack yarn build

if [[ "$MODE" == "--keep" ]]; then
  echo "== 4/4 keep (patches remain applied for dev) =="
else
  echo "== 4/4 restore (repo back to pristine) =="
  git checkout -- . && git clean -fd > /dev/null 2>&1 || true
fi

echo ""
echo "Done. build/ updated — caddy serves it directly (no restart needed)."
