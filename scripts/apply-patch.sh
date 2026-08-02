#!/usr/bin/env bash
# ============================================================
# apply-patch.sh - apply/export Excalidraw frontend patches
#
# Usage:
#   ./apply-patch.sh /path/to/excalidraw            # apply (excalidraw.patch + new/)
#   ./apply-patch.sh /path/to/excalidraw --export   # re-export patches from tree
#
# Prereq: /path/to/excalidraw is an excalidraw/excalidraw clone
#         (pinned to the upstream commit recorded in patch/README.md)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_DIR="$SCRIPT_DIR/../patch"
TARGET="${1:?usage: ./apply-patch.sh /path/to/excalidraw [--export]}"
MODE="${2:-apply}"

if [[ ! -d "$TARGET/.git" ]]; then
  echo "ERROR: $TARGET is not a git repo (need an excalidraw/excalidraw clone)"
  exit 1
fi

if [[ "$MODE" == "--export" ]]; then
  echo "Exporting customizations from $TARGET to $PATCH_DIR ..."
  cd "$TARGET"
  git diff > "$PATCH_DIR/excalidraw.patch"
  # new/: copy only untracked source files (exclude node_modules etc.)
  while IFS= read -r f; do
    dst="$PATCH_DIR/new/$f"
    mkdir -p "$(dirname "$dst")"
    cp "$f" "$dst"
    echo "  OK $f"
  done < <(git ls-files --others --exclude-standard | grep -v '^node_modules/' || true)
  echo "Done. excalidraw.patch: $(wc -l < "$PATCH_DIR/excalidraw.patch") lines"
  exit 0
fi

echo "Applying patches to $TARGET ..."
cd "$TARGET"

if [[ -s "$PATCH_DIR/excalidraw.patch" ]]; then
  if git apply --check "$PATCH_DIR/excalidraw.patch" 2>/dev/null; then
    git apply "$PATCH_DIR/excalidraw.patch" && echo "OK excalidraw.patch applied"
  else
    echo "SKIP excalidraw.patch (already applied or conflicts - check git status)"
  fi
fi
if [[ -d "$PATCH_DIR/new" ]]; then
  cp -R "$PATCH_DIR/new/." "$TARGET/" && echo "OK new/ copied"
fi

echo ""
echo "Next (in $TARGET):"
echo "  corepack yarn build   # produces excalidraw-app/build/ served by caddy"
