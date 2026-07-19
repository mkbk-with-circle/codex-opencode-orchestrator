#!/usr/bin/env bash
# 恢复「模拟新 clone 前」备份的本机配置 / API key。
# 备份位置（默认）: ~/Desktop/.codex-opencode-orchestrator-local-backup
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP="${ORCHESTRATOR_LOCAL_BACKUP:-$HOME/Desktop/.codex-opencode-orchestrator-local-backup}"

if [[ ! -x "$BACKUP/restore.sh" ]]; then
  echo "找不到备份: $BACKUP/restore.sh" >&2
  echo "若你移动过备份，请: export ORCHESTRATOR_LOCAL_BACKUP=/path/to/backup" >&2
  exit 1
fi

export ORCHESTRATOR_ROOT="$ROOT"
exec bash "$BACKUP/restore.sh"
