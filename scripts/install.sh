#!/usr/bin/env bash
# ============================================================
# excalidraw-selfhost install.sh — 一键生成配置 + 安装 launchd
#
# 用法:
#   cp .env.example .env   # 填你的配置
#   ./install.sh           # 生成配置并安装/重启服务
#   ./install.sh --dry-run # 只生成不安装
#
# 幂等：可重复执行。生成物在 deploy/generated/，launchd plist 在
# ~/Library/LaunchAgents/（通过 symlink 指向生成物，便于版本追踪）。
# ============================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env"
GENERATED="$REPO_DIR/deploy/generated"
DRY_RUN="${1:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ 没有 .env 文件。先: cp .env.example .env 并填写你的配置"
  exit 1
fi

# 加载 .env（不导出敏感值到子进程环境以外的地方）
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ── 默认值（与 .env.example 一致）─────────────────────────
: "${CADDY_PORT:=3001}"
: "${WS_PORT:=3020}"
: "${AI_PORT:=3016}"
: "${DOMAIN:=draw.example.com}"
: "${LAUNCH_AGENTS_DIR:=$HOME/Library/LaunchAgents}"
: "${CLOUDFLARED_DIR:=$HOME/.cloudflared}"
: "${EXCALIDRAW_REPO_DIR:=$REPO_DIR/../excalidraw}"
: "${WS_DATA_DIR:=$REPO_DIR/apps/ws-server/data}"
: "${JWT_SECRET_FILE:=$WS_DATA_DIR/.jwt-secret}"
: "${OPENAI_CONFIG_FILE:=$HOME/.hermes/config.yaml}"
: "${MODEL:=deepseek-v4-flash}"
: "${OPENAI_BASE:=https://opencode.ai/zen/go/v1}"
: "${CLOUDFLARED_LOG:=$CLOUDFLARED_DIR/excalidraw-tunnel.log}"
: "${ACCESS_LOG:=/tmp/caddy-access.log}"

mkdir -p "$GENERATED"
mkdir -p "$WS_DATA_DIR"   # 数据目录（个人数据，gitignored；server.js 也会自动创建）

echo "=========================================="
echo " excalidraw-selfhost 配置生成"
echo " repo:      $REPO_DIR"
echo " domain:    $DOMAIN"
echo " ports:     caddy=$CADDY_PORT ws=$WS_PORT ai=$AI_PORT"
echo " build dir: $EXCALIDRAW_REPO_DIR/excalidraw-app/build"
echo "=========================================="

# ── 检查前端构建产物 ───────────────────────────────────────
if [[ ! -d "$EXCALIDRAW_REPO_DIR/excalidraw-app/build" ]]; then
  echo "⚠️  未找到前端构建产物 $EXCALIDRAW_REPO_DIR/excalidraw-app/build"
  echo "   请先在前端 repo 打补丁并构建（见 README frontend 章节）"
fi

# ── 生成 Caddyfile ─────────────────────────────────────────
DOMAIN_ALT_BLOCK=""
if [[ -n "${DOMAIN_ALT:-}" ]]; then
  DOMAIN_ALT_BLOCK=", https://${DOMAIN_ALT}:${CADDY_PORT}"
fi
DOMAIN_ALT_INGRESS=""
if [[ -n "${DOMAIN_ALT:-}" ]]; then
  DOMAIN_ALT_INGRESS="  - hostname: ${DOMAIN_ALT}
    service: https://localhost:${CADDY_PORT}
    originRequest:
      originServerName: localhost
      noTLSVerify: true
"
fi

sed -e "s|__CADDY_PORT__|$CADDY_PORT|g" \
    -e "s|__DOMAIN__|$DOMAIN|g" \
    -e "s|__DOMAIN_ALT_BLOCK__|$DOMAIN_ALT_BLOCK|g" \
    -e "s|__EXCALIDRAW_BUILD_DIR__|$EXCALIDRAW_REPO_DIR/excalidraw-app/build|g" \
    -e "s|__WS_PORT__|$WS_PORT|g" \
    -e "s|__AI_PORT__|$AI_PORT|g" \
    -e "s|__ACCESS_LOG__|$ACCESS_LOG|g" \
    "$REPO_DIR/deploy/caddy/Caddyfile.template" > "$GENERATED/Caddyfile"
echo "✅ Caddyfile"

# ── 生成 tunnel.yml ────────────────────────────────────────
if [[ -n "${CLOUDFLARE_TUNNEL_ID:-}" ]]; then
  CRED_FILE="${CLOUDFLARE_CREDENTIALS_FILE:-$CLOUDFLARED_DIR/excalidraw-tunnel.json}"
  {
    echo "tunnel: $CLOUDFLARE_TUNNEL_ID"
    echo "credentials-file: $CRED_FILE"
    echo "ingress:"
    echo "  - hostname: $DOMAIN"
    echo "    service: https://localhost:$CADDY_PORT"
    echo "    originRequest:"
    echo "      originServerName: localhost"
    echo "      noTLSVerify: true"
    if [[ -n "${DOMAIN_ALT:-}" ]]; then
      echo "  - hostname: $DOMAIN_ALT"
      echo "    service: https://localhost:$CADDY_PORT"
      echo "    originRequest:"
      echo "      originServerName: localhost"
      echo "      noTLSVerify: true"
    fi
    echo "  - service: http_status:404"
  } > "$GENERATED/tunnel.yml"
  echo "✅ tunnel.yml (tunnel: $CLOUDFLARE_TUNNEL_ID)"
else
  rm -f "$GENERATED/tunnel.yml"
  echo "⏭️  tunnel.yml 跳过（未设置 CLOUDFLARE_TUNNEL_ID）"
fi

# ── 生成 plist（ws / ai / caddy / cloudflared）─────────────
gen_plist() {
  local template="$1" output="$2"
  sed -e "s|__REPO_DIR__|$REPO_DIR|g" \
      -e "s|__WS_PORT__|$WS_PORT|g" \
      -e "s|__AI_PORT__|$AI_PORT|g" \
      -e "s|__WS_DATA_DIR__|$WS_DATA_DIR|g" \
      -e "s|__JWT_SECRET_FILE__|$JWT_SECRET_FILE|g" \
      -e "s|__OPENAI_API_KEY__|${OPENAI_API_KEY:-}|g" \
      -e "s|__OPENAI_CONFIG_FILE__|$OPENAI_CONFIG_FILE|g" \
      -e "s|__MODEL__|$MODEL|g" \
      -e "s|__OPENAI_BASE__|$OPENAI_BASE|g" \
      -e "s|__CLOUDFLARED_LOG__|$CLOUDFLARED_LOG|g" \
      "$template" > "$output"
  echo "✅ $(basename "$output")"
}

gen_plist "$REPO_DIR/deploy/launchd/com.excalidraw.ws-backend.plist.template" "$GENERATED/com.excalidraw.ws-backend.plist"
gen_plist "$REPO_DIR/deploy/launchd/com.excalidraw.ai-backend.plist.template" "$GENERATED/com.excalidraw.ai-backend.plist"
gen_plist "$REPO_DIR/deploy/launchd/com.excalidraw.caddy.plist.template" "$GENERATED/com.excalidraw.caddy.plist"
if [[ -n "${CLOUDFLARE_TUNNEL_ID:-}" ]]; then
  gen_plist "$REPO_DIR/deploy/launchd/com.excalidraw.cloudflared.plist.template" "$GENERATED/com.excalidraw.cloudflared.plist"
else
  rm -f "$GENERATED/com.excalidraw.cloudflared.plist"
  echo "⏭️  cloudflared plist 跳过"
fi

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo ""
  echo "✅ 生成完成（dry-run，未安装）。检查 deploy/generated/ 后执行 ./install.sh"
  exit 0
fi

# ── 安装 launchd（symlink 到生成物）────────────────────────
mkdir -p "$LAUNCH_AGENTS_DIR"
for job in ws-backend ai-backend caddy cloudflared; do
  src="$GENERATED/com.excalidraw.$job.plist"
  dst="$LAUNCH_AGENTS_DIR/com.excalidraw.$job.plist"
  if [[ ! -f "$src" ]]; then
    # 之前存在则移除（如停用 tunnel）
    [[ -f "$dst" || -L "$dst" ]] && launchctl bootout "gui/$(id -u)/com.excalidraw.$job" 2>/dev/null || true
    rm -f "$dst"
    echo "⏭️  $job 已移除"
    continue
  fi
  ln -sfn "$src" "$dst"
  echo "🔗 $job plist -> $dst"
done

# ── 同步 Caddyfile / tunnel.yml 到 ~/.cloudflared（symlink）──
# 单源：实体只在 deploy/generated/，运行位只是链接。
mkdir -p "$CLOUDFLARED_DIR"
if [[ -f "$GENERATED/Caddyfile" ]]; then
  ln -sfn "$GENERATED/Caddyfile" "$CLOUDFLARED_DIR/excalidraw-Caddyfile"
  echo "🔗 Caddyfile -> $CLOUDFLARED_DIR/excalidraw-Caddyfile"
fi
if [[ -f "$GENERATED/tunnel.yml" ]]; then
  ln -sfn "$GENERATED/tunnel.yml" "$CLOUDFLARED_DIR/excalidraw-tunnel.yml"
  echo "🔗 tunnel.yml -> $CLOUDFLARED_DIR/excalidraw-tunnel.yml"
fi

echo ""
echo "服务安装完成。如需立即生效："
echo "  launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.excalidraw.ws-backend.plist"
echo "或重启机器（RunAtLoad 自动加载）。"
