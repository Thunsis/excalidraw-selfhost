#!/usr/bin/env bash
# ============================================================
# frontend/apply.sh - apply/export Excalidraw frontend patches
#
# Usage:
#   ./apply.sh /path/to/excalidraw            # apply patches (custom.diff + new-files)
#   ./apply.sh /path/to/excalidraw --export   # re-export patches from working tree
#
# Prereq: /path/to/excalidraw is an excalidraw/excalidraw clone
#         (pinned to the upstream commit recorded in the repo README)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCHES_DIR="$SCRIPT_DIR/patches"
TARGET="${1:?usage: ./apply.sh /path/to/excalidraw [--export]}"
MODE="${2:-apply}"

if [[ ! -d "$TARGET/.git" ]]; then
  echo "ERROR: $TARGET is not a git repo (need an excalidraw/excalidraw clone)"
  exit 1
fi

if [[ "$MODE" == "--export" ]]; then
  echo "Exporting customizations from $TARGET to $PATCHES_DIR ..."
  cd "$TARGET"
  git diff > "$PATCHES_DIR/custom.diff"
  # new-files: copy only untracked source files (exclude node_modules etc.)
  while IFS= read -r f; do
    dst="$PATCHES_DIR/new-files/$f"
    mkdir -p "$(dirname "$dst")"
    cp "$f" "$dst"
    echo "  OK $f"
  done < <(git ls-files --others --exclude-standard | grep -v '^node_modules/' || true)
  echo "Done. custom.diff: $(wc -l < "$PATCHES_DIR/custom.diff") lines"
  exit 0
fi

echo "Applying patches to $TARGET ..."
cd "$TARGET"

if [[ -s "$PATCHES_DIR/custom.diff" ]]; then
  if git apply --check "$PATCHES_DIR/custom.diff" 2>/dev/null; then
    git apply "$PATCHES_DIR/custom.diff" && echo "OK custom.diff applied"
  else
    echo "SKIP custom.diff (already applied or conflicts - check git status)"
  fi
fi
if [[ -d "$PATCHES_DIR/new-files" ]]; then
  cp -R "$PATCHES_DIR/new-files/." "$TARGET/" && echo "OK new-files copied"
fi

echo ""
echo "Next (in $TARGET):"
echo "  corepack yarn build   # produces excalidraw-app/build/ served by caddy"
