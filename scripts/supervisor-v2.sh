#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"
ROOT="$(orch_root)"
STATE_DIR="$HOME/.config/codex-opencode-orchestrator/supervisor"
PID_FILE="$STATE_DIR/supervisor.pid"
META_FILE="$STATE_DIR/supervisor.json"
LOG_FILE="$STATE_DIR/supervisor.log"
secure_state_dir "$STATE_DIR"

latest_session_for_workspace() {
  node - "$1" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const workspace = path.resolve(process.argv[2]);
const root = path.join(process.env.HOME || "", ".codex", "sessions");
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const value = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(value, out);
    else if (/^rollout-.*\.jsonl$/.test(entry.name)) out.push(value);
  }
  return out;
}
for (const file of walk(root).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)) {
  try {
    const first = JSON.parse(fs.readFileSync(file,"utf8").split("\n",1)[0]);
    const payload = first.payload || {};
    if (path.resolve(payload.cwd || ".") === workspace) {
      const id = payload.session_id || payload.id;
      if (id) { process.stdout.write(String(id)); break; }
    }
  } catch {}
}
JS
}

stop_supervisor() {
  if [[ -f "$PID_FILE" ]]; then
    pid="$(sed -n '1p' "$PID_FILE" 2>/dev/null || true)"
    if stop_managed_process "$pid" "$SCRIPT_DIR/supervisor-v2-daemon.sh"; then
      echo "已停止 v2 supervisor pid=$pid"
    elif [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "拒绝停止 pid=$pid：它不是本项目的 supervisor 进程" >&2
    else
      echo "v2 supervisor 未运行"
    fi
    : >"$PID_FILE"
  else
    echo "v2 supervisor 未运行"
  fi
}

start_supervisor() {
  interval=60 run_id="" session_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --interval) interval="${2:-60}"; shift 2 ;;
      --run) run_id="${2:-}"; shift 2 ;;
      --session) session_id="${2:-}"; shift 2 ;;
      *) echo "未知参数: $1" >&2; exit 1 ;;
    esac
  done
  if ! [[ "$interval" =~ ^[0-9]+$ ]] || [[ "$interval" -lt 5 ]]; then
    echo "--interval 至少 5 秒" >&2; exit 1
  fi
  status_args=(run-status)
  if [[ -n "$run_id" ]]; then status_args+=(--run "$run_id"); fi
  status="$(bridge_cli "$ROOT" "${status_args[@]}")"
  run_id="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).run.id))' <<<"$status")"
  workspace="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).run.workspace))' <<<"$status")"
  if [[ -z "$session_id" ]]; then
    session_id="$(latest_session_for_workspace "$workspace")"
  fi
  if [[ -z "$session_id" ]]; then
    echo "找不到 Codex supervisor session；请用 --session <uuid> 指定一个专用会话" >&2
    exit 1
  fi
  stop_supervisor >/dev/null || true
  export SUPERVISOR_ROOT="$ROOT" SUPERVISOR_RUN_ID="$run_id" SUPERVISOR_SESSION_ID="$session_id"
  export SUPERVISOR_INTERVAL="$interval" SUPERVISOR_PID_FILE="$PID_FILE" SUPERVISOR_SCRIPT_DIR="$SCRIPT_DIR"
  touch "$LOG_FILE"
  chmod 600 "$LOG_FILE"
  nohup bash "$SCRIPT_DIR/supervisor-v2-daemon.sh" >>"$LOG_FILE" 2>&1 &
  pid=$!
  echo "$pid" >"$PID_FILE"
  node -e 'const [runId,workspace,sessionId,intervalSec,pid,log]=process.argv.slice(1);console.log(JSON.stringify({runId,workspace,sessionId,intervalSec:Number(intervalSec),pid:Number(pid),log},null,2))' "$run_id" "$workspace" "$session_id" "$interval" "$pid" "$LOG_FILE" >"$META_FILE"
  chmod 600 "$PID_FILE" "$META_FILE"
  sed -n '1,120p' "$META_FILE"
}

case "${1:-status}" in
  start) shift; start_supervisor "$@" ;;
  stop|cancel) stop_supervisor ;;
  status)
    if [[ -f "$PID_FILE" ]] && pid="$(sed -n '1p' "$PID_FILE")" && pid_matches_script "$pid" "$SCRIPT_DIR/supervisor-v2-daemon.sh"; then
      echo "running"; sed -n '1,120p' "$META_FILE"
    else
      echo "stopped"
    fi
    ;;
  *) echo "用法: orch watch start [--run id] [--session uuid] [--interval 60] | stop | status" >&2; exit 1 ;;
esac
