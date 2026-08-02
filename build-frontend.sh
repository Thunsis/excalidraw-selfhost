#!/usr/bin/env bash
# ============================================================
# build-frontend.sh - one-shot frontend build from patches
#
# Single-source workflow: patches are the ONLY truth.
#   1. restore excalidraw repo to pristine upstream
#   2. apply patches (custom.diff + new-files)
#   3. yarn build -> excalidraw-app/build/ (served by caddy)
#   4. restore again (clean tree = reproducible, patch-driven)
#
# Usage:
#   ./build-frontend.sh /path/to/excalidraw          # apply + build + restore
#   ./build-frontend.sh /path/to/excalidraw --keep   # apply + build, keep tree dirty
#   ./build-frontend.sh /path/to/excalidraw --apply  # only apply (dev work)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:?usage: ./build-frontend.sh /path/to/excalidraw [--keep|--apply]}"
MODE="${2:-}"

if [[ ! -d "$TARGET/.git" ]]; then
  echo "ERROR: $TARGET is not a git repo"
  exit 1
fi

restore_clean() {
  echo "→ restoring $TARGET to pristine upstream ..."
  git -C "$TARGET" checkout -- .
  git -C "$TARGET" clean -fd > /dev/null 2>&1 || true
}

case "$MODE" in
  --apply)
    "$SCRIPT_DIR/frontend/apply.sh" "$TARGET"
    echo ""
    echo "Tree patched. Do your dev work, then re-export:"
    echo "  $SCRIPT_DIR/frontend/apply.sh $TARGET --export"
    echo "  $SCRIPT_DIR/build-frontend.sh $TARGET"
    exit 0
    ;;
  --keep)
    restore_clean
    "$SCRIPT_DIR/frontend/apply.sh" "$TARGET"
    ;;
  *)
    restore_clean
    "$SCRIPT_DIR/frontend/apply.sh" "$TARGET"
    ;;
esac

echo "→ building ..."
cd "$TARGET"
corepack yarn build 2>&1 | tail -3
echo "✅ build done"

if [[ "$MODE" != "--keep" ]]; then
  restore_clean
  echo "✅ tree restored to pristine (patches remain the single source of truth)"
fi

echo ""
echo "Verify:"
echo "  curl -s -o /dev/null -w '%{http_code}' https://your.domain/"
