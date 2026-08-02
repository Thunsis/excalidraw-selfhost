#!/usr/bin/env bash
# ============================================================
# frontend/apply.sh — 将补丁集应用到 excalidraw 前端 repo
#
# 用法:
#   ./apply.sh /path/to/excalidraw          # 应用补丁（custom.diff + new-files）
#   ./apply.sh /path/to/excalidraw --export # 从工作区重新导出补丁
#
# 前提: /path/to/excalidraw 是 excalidraw/excalidraw 官方 repo clone
#       （版本需匹配 frontend/patches/ 对应的上游 commit）
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCHES_DIR="$SCRIPT_DIR/patches"
TARGET="${1:?用法: ./apply.sh /path/to/excalidraw [--export]}"
MODE="${2:-apply}"

if [[ ! -d "$TARGET/.git" ]]; then
  echo "❌ $TARGET 不是 git repo（需要 excalidraw/excalidraw clone）"
  exit 1
fi

if [[ "$MODE" == "--export" ]]; then
  echo "→ 从 $TARGET 导出定制到 $PATCHES_DIR ..."
  cd "$TARGET"
  git diff > "$PATCHES_DIR/custom.diff"
  # new-files: 仅拷贝已知新增文件（避免把 node_modules 等误入）
  while IFS= read -r f; do
    dst="$PATCHES_DIR/new-files/$f"
    mkdir -p "$(dirname "$dst")"
    cp "$f" "$dst"
    echo "  ✅ $f"
  done < <(git ls-files --others --exclude-standard | grep -v '^node_modules/' || true)
  echo "✅ 导出完成: custom.diff ($(wc -l < "$PATCHES_DIR/custom.diff") 行)"
  exit 0
fi

echo "→ 应用补丁到 $TARGET ..."
cd "$TARGET"

if [[ -s "$PATCHES_DIR/custom.diff" ]]; then
  git apply "$PATCHES_DIR/custom.diff" && echo "✅ custom.diff 应用成功"
fi
if [[ -d "$PATCHES_DIR/new-files" ]]; then
  cp -R "$PATCHES_DIR/new-files/." "$TARGET/" && echo "✅ new-files 复制成功"
fi

echo ""
echo "下一步（在 $TARGET）:"
echo "  corepack yarn build   # 产出 excalidraw-app/build/ 供 caddy 服务"
