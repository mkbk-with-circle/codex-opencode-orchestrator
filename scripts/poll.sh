#!/usr/bin/env bash
# 轮询只保留两个命令：
#   bash scripts/poll.sh start [--interval 60] [--session UUID]
#   bash scripts/poll.sh stop
#
# 有 plan 变更才 resume 当前会话；无变更不调模型。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

ROOT="$(orch_root)"
STATE_DIR="${HOME}/.config/codex-opencode-orchestrator/poll"
PID_FILE="$STATE_DIR/poll.pid"
META_FILE="$STATE_DIR/poll.json"
LOG_FILE="$STATE_DIR/poll.log"
mkdir -p "$STATE_DIR"

latest_tui_session_id() {
  python3 - "$1" <<'PY'
import json, sys
from pathlib import Path
prefer_cwd = (sys.argv[1] or "").rstrip("/")
root = Path.home() / ".codex" / "sessions"
files = sorted(root.rglob("rollout-*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
best = None
best_any = None
for p in files[:50]:
    try:
        with p.open() as f:
            line = f.readline()
        d = json.loads(line)
        if d.get("type") != "session_meta":
            continue
        pl = d.get("payload") or {}
        sid = pl.get("session_id") or pl.get("id")
        if not sid:
            continue
        if best_any is None:
            best_any = sid
        cwd = (pl.get("cwd") or "").rstrip("/")
        orig = (pl.get("originator") or "")
        if prefer_cwd and cwd == prefer_cwd and "tui" in orig:
            print(sid)
            raise SystemExit(0)
        if best is None and "tui" in orig:
            best = sid
    except SystemExit:
        raise
    except Exception:
        continue
print(best or best_any or "")
PY
}

cmd_stop() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      kill -9 "$pid" 2>/dev/null || true
      echo "已停止轮询 pid=$pid"
    else
      echo "没有正在运行的轮询（pid 无效）"
    fi
    rm -f "$PID_FILE"
  else
    echo "没有正在运行的轮询"
  fi
}

cmd_start() {
  local interval=60 session_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --interval) interval="${2:-60}"; shift 2 ;;
      --session) session_id="${2:-}"; shift 2 ;;
      *)
        echo "未知参数: $1（仅 --interval / --session）" >&2
        exit 1
        ;;
    esac
  done
  if ! [[ "$interval" =~ ^[0-9]+$ ]] || [[ "$interval" -lt 5 ]]; then
    echo "--interval 至少 5 秒" >&2
    exit 1
  fi

  cmd_stop >/dev/null || true

  local ws_json plans_dir workspace bound
  ws_json="$(bridge_cli "$ROOT" workspace 2>/dev/null || echo '{}')"
  bound="$(echo "$ws_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print('1' if d.get('bound') else '')")"
  workspace="$(echo "$ws_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('targetWorkspace') or '')")"
  plans_dir="$(echo "$ws_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('plansDir') or '')")"

  if [[ -z "$bound" || -z "$workspace" ]]; then
    echo "未绑定工作目录。请先: bash scripts/set-workspace.sh /业务仓绝对路径" >&2
    exit 1
  fi
  [[ -n "$plans_dir" ]] || plans_dir="$workspace/.orchestrator/plans"
  mkdir -p "$plans_dir"

  if [[ -z "$session_id" ]]; then
    session_id="$(latest_tui_session_id "$workspace")"
  fi
  if [[ -z "$session_id" ]]; then
    echo "无法解析当前会话 id。请: orch poll start --interval 60 --session <uuid>" >&2
    exit 1
  fi

  export POLL_INTERVAL="$interval"
  export POLL_SESSION_ID="$session_id"
  export POLL_PLANS_DIR="$plans_dir"
  export POLL_WORKSPACE="$workspace"
  export POLL_LOG_FILE="$LOG_FILE"
  export POLL_PID_FILE="$PID_FILE"
  export POLL_SCRIPT_DIR="$SCRIPT_DIR"

  nohup bash "$SCRIPT_DIR/poll-daemon.sh" >>"$LOG_FILE" 2>&1 &
  local bg=$!
  # daemon rewrites PID_FILE to its own $$
  sleep 0.3
  local real_pid
  real_pid="$(cat "$PID_FILE" 2>/dev/null || echo "$bg")"

  python3 -c "
import json
meta = {
  'ok': True,
  'intervalSec': int('$interval'),
  'sessionId': '''$session_id''',
  'plansDir': '''$plans_dir''',
  'workspace': '''$workspace''',
  'pid': int('''$real_pid'''),
  'log': '''$LOG_FILE''',
  'mode': 'plan-or-needs-user-mtime-wake',
  'stop': 'orch poll stop',
}
open('''$META_FILE''','w').write(json.dumps(meta, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(meta, ensure_ascii=False, indent=2))
"
  echo "POLL_STARTED — plan / needs-user 变更时唤醒；取消: orch poll stop"
}

case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  stop|cancel) cmd_stop ;;
  status)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "running"; cat "$META_FILE" 2>/dev/null || true
    else
      echo "stopped"
    fi
    ;;
  ""|-h|--help)
    cat <<'EOF'
用法（只要这两个）:
  orch poll start [--interval 60] [--session <uuid>]
  orch poll stop

每隔 interval 秒看绑定仓:
  .orchestrator/plans/*.md
  .orchestrator/needs-user.md（需用户输入时 OpenCode 写入）
有修改 → resume 当前会话查进度 / 向用户提问
无修改 → 不调用模型
EOF
    ;;
  *)
    echo "未知子命令: $1（只要 start / stop）" >&2
    exit 1
    ;;
esac
