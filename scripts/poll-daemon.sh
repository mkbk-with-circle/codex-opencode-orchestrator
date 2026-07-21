#!/usr/bin/env bash
# 后台守护：plan 或 needs-user 变更时 resume 指定会话
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
ORCH_DIR="$WORKSPACE/.orchestrator"

watch_fingerprint() {
  python3 - "$1" "$2" <<'PY'
from pathlib import Path
import sys
plans = Path(sys.argv[1])
orch = Path(sys.argv[2])
rows = []
if plans.is_dir():
    for p in sorted(plans.glob("*.md")):
        st = p.stat()
        rows.append(f"plan:{p.name}:{st.st_mtime_ns}:{st.st_size}")
else:
    rows.append("plans:MISSING")
# Human-gate markers (Codex must pause and ask user)
for name in ("needs-user.md", "user-reply.md"):
    p = orch / name
    if p.is_file():
        st = p.stat()
        rows.append(f"gate:{name}:{st.st_mtime_ns}:{st.st_size}")
    else:
        rows.append(f"gate:{name}:ABSENT")
print("|".join(rows) if rows else "EMPTY")
PY
}

echo "$$" >"$PID_FILE"
last="$(watch_fingerprint "$PLANS_DIR" "$ORCH_DIR")"
echo "$(date -Iseconds) daemon start interval=${INTERVAL}s session=$SESSION_ID fp=$last"

while true; do
  sleep "$INTERVAL"
  if [[ ! -f "$PID_FILE" ]]; then
    echo "$(date -Iseconds) pid file removed, exit"
    exit 0
  fi
  cur="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$cur" && "$cur" != "$$" ]]; then
    echo "$(date -Iseconds) superseded by pid $cur, exit"
    exit 0
  fi

  fp="$(watch_fingerprint "$PLANS_DIR" "$ORCH_DIR")"
  if [[ "$fp" == "$last" ]]; then
    echo "$(date -Iseconds) unchanged"
    continue
  fi
  echo "$(date -Iseconds) changed $last -> $fp ; waking $SESSION_ID"
  last="$fp"

  prompt="$(cat <<EOF
【编排器 poll 唤醒 — plan / needs-user 有变更】
绑定工作目录: ${WORKSPACE}
plans 目录: ${PLANS_DIR}

请只做这些事（当前会话续写）：
1. 若存在 ${WORKSPACE}/.orchestrator/needs-user.md 且 status: open → 立刻走 \$opencode-ask-user：停止推进，向用户提问，不要 rework/dispatch/mark_complete
2. 否则用 MCP opencode_bridge 的 status（看 phases / awaiting_review）汇报进度
3. 不要改业务代码；不要重新派工除非用户已要求或已提供所需信息

变更指纹: ${fp}
EOF
)"

  if ! CODEX_BIN="$(resolve_codex_bin)"; then
    echo "$(date -Iseconds) no codex"
    continue
  fi
  # 监督唤醒：默认最便宜 Codex 模型
  CODEX_MODEL="${CODEX_MODEL:-gpt-5.6-luna}"
  CODEX_REASONING_EFFORT="${CODEX_REASONING_EFFORT:-low}"
  "$CODEX_BIN" exec resume \
    --skip-git-repo-check \
    -m "$CODEX_MODEL" \
    -c "model_reasoning_effort=\"${CODEX_REASONING_EFFORT}\"" \
    "$SESSION_ID" "$prompt" </dev/null \
    || echo "$(date -Iseconds) resume failed"
done
