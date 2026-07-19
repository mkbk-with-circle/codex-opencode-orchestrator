#!/usr/bin/env bash
# 后台守护：只在 plan 文件变更时 resume 指定会话
set -euo pipefail

SCRIPT_DIR="${POLL_SCRIPT_DIR:-$(cd "$(dirname "$0")" && pwd)}"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

INTERVAL="${POLL_INTERVAL:?}"
SESSION_ID="${POLL_SESSION_ID:?}"
PLANS_DIR="${POLL_PLANS_DIR:?}"
WORKSPACE="${POLL_WORKSPACE:?}"
LOG_FILE="${POLL_LOG_FILE:?}"
PID_FILE="${POLL_PID_FILE:?}"

plans_fingerprint() {
  python3 - "$1" <<'PY'
from pathlib import Path
import sys
d = Path(sys.argv[1])
if not d.is_dir():
    print("MISSING")
    raise SystemExit(0)
rows = []
for p in sorted(d.glob("*.md")):
    st = p.stat()
    rows.append(f"{p.name}:{st.st_mtime_ns}:{st.st_size}")
print("|".join(rows) if rows else "EMPTY")
PY
}

echo "$$" >"$PID_FILE"
last="$(plans_fingerprint "$PLANS_DIR")"
echo "$(date -Iseconds) daemon start interval=${INTERVAL}s session=$SESSION_ID fp=$last"

while true; do
  sleep "$INTERVAL"
  if [[ ! -f "$PID_FILE" ]]; then
    echo "$(date -Iseconds) pid file removed, exit"
    exit 0
  fi
  # stop if our pid file points elsewhere
  cur="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$cur" && "$cur" != "$$" ]]; then
    echo "$(date -Iseconds) superseded by pid $cur, exit"
    exit 0
  fi

  fp="$(plans_fingerprint "$PLANS_DIR")"
  if [[ "$fp" == "$last" ]]; then
    echo "$(date -Iseconds) unchanged"
    continue
  fi
  echo "$(date -Iseconds) changed $last -> $fp ; waking $SESSION_ID"
  last="$fp"

  prompt="$(cat <<EOF
【编排器 poll 唤醒 — plan 文件有变更】
绑定工作目录: ${WORKSPACE}
plans 目录: ${PLANS_DIR}

请只做这些事（当前会话续写）：
1. 用 MCP opencode_bridge 的 status / progress（必要时 list_plans）查看进度
2. 用一两句话汇报：是否在推进、是否卡住、要不要 interrupt/rework
3. 不要改业务代码，不要重新派工除非用户已要求

变更指纹: ${fp}
EOF
)"

  if ! CODEX_BIN="$(resolve_codex_bin)"; then
    echo "$(date -Iseconds) no codex"
    continue
  fi
  "$CODEX_BIN" exec resume --skip-git-repo-check "$SESSION_ID" "$prompt" </dev/null \
    || echo "$(date -Iseconds) resume failed"
done
