#!/usr/bin/env bash
# ============================================================
# backup.sh - SQLite backup (WAL-safe), keep last N snapshots
#
# Usage:
#   ./backup.sh                  # backup to default dir, keep 7
#   ./backup.sh /path/to/dir 14  # custom dir, keep 14
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

# load .env if present (WS_DATA_DIR / DB_PATH overrides)
if [[ -f "$ENV_FILE" ]]; then
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
fi

DATA_DIR="${WS_DATA_DIR:-$SCRIPT_DIR/apps/ws-server/data}"
DB_FILE="${DB_PATH:-$DATA_DIR/workspace.db}"
BACKUP_DIR="${1:-$DATA_DIR/backups}"
KEEP="${2:-7}"

if [[ ! -f "$DB_FILE" ]]; then
  echo "SKIP: no database at $DB_FILE"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/workspace-$STAMP.db"

# WAL-safe online backup (consistent even while server is running)
sqlite3 "$DB_FILE" ".backup '$DEST'"

# prune old snapshots
ls -1t "$BACKUP_DIR"/workspace-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "✅ backup: $DEST ($(du -h "$DEST" | cut -f1))"
echo "   kept:   $(ls -1 "$BACKUP_DIR"/workspace-*.db 2>/dev/null | wc -l | tr -d ' ') snapshots"
