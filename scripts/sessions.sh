#!/usr/bin/env bash
# 按「业务仓 cwd」管理 Codex 会话（配合 codex-in-workspace.sh）
#
#   orch sessions              列出本业务仓相关会话
#   orch resume                恢复本仓最近一条 TUI 会话
#   orch resume <uuid|name|#n> 恢复指定会话
#   orch session pin <name>    给本仓最近会话起别名
#   orch session last          打印本仓最近会话 id
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

ROOT="$(orch_root)"
REG_DIR="${HOME}/.config/codex-opencode-orchestrator/sessions"
mkdir -p "$REG_DIR"

workspace_abs() {
  local w="${TARGET_WORKSPACE:-${ORCHESTRATOR_TARGET_WORKSPACE:-$PWD}}"
  w="${w/#\~/$HOME}"
  (cd "$w" 2>/dev/null && pwd) || echo "$w"
}

ws_key() {
  python3 -c "import hashlib,sys; print(hashlib.sha1(sys.argv[1].encode()).hexdigest()[:12])" "$1"
}

reg_file() {
  echo "$REG_DIR/$(ws_key "$1").json"
}

# List sessions whose cwd matches workspace (tui preferred)
list_sessions_json() {
  local ws="$1" limit="${2:-30}"
  python3 - "$ws" "$limit" <<'PY'
import json, sys
from pathlib import Path
ws = sys.argv[1].rstrip("/")
limit = int(sys.argv[2])
root = Path.home() / ".codex" / "sessions"
idx = {}
sip = Path.home() / ".codex" / "session_index.jsonl"
if sip.exists():
    for line in sip.read_text().splitlines():
        try:
            d = json.loads(line)
            if d.get("id"):
                idx[d["id"]] = d
        except Exception:
            pass
rows = []
for p in sorted(root.rglob("rollout-*.jsonl"), key=lambda x: x.stat().st_mtime, reverse=True):
    try:
        d = json.loads(p.open().readline())
        if d.get("type") != "session_meta":
            continue
        pl = d.get("payload") or {}
        sid = pl.get("session_id") or pl.get("id")
        cwd = (pl.get("cwd") or "").rstrip("/")
        if not sid or cwd != ws:
            continue
        meta = idx.get(sid) or {}
        rows.append({
            "id": sid,
            "cwd": cwd,
            "originator": pl.get("originator") or "",
            "thread_name": meta.get("thread_name") or "",
            "updated_at": meta.get("updated_at") or pl.get("timestamp") or "",
            "mtime": p.stat().st_mtime,
            "file": str(p),
        })
    except Exception:
        continue
# prefer tui, then by mtime
rows.sort(key=lambda r: (0 if "tui" in (r["originator"] or "") else 1, -r["mtime"]))
print(json.dumps(rows[:limit], ensure_ascii=False))
PY
}

load_registry() {
  local f
  f="$(reg_file "$1")"
  if [[ -f "$f" ]]; then
    cat "$f"
  else
    echo '{"workspace":"'"$1"'","pins":{},"lastId":null}'
  fi
}

save_registry() {
  local ws="$1" json="$2"
  local f
  f="$(reg_file "$ws")"
  echo "$json" >"$f"
}

cmd_list() {
  local ws
  ws="$(workspace_abs)"
  local rows
  rows="$(list_sessions_json "$ws" 40)"
  local reg
  reg="$(load_registry "$ws")"
  python3 - "$ws" "$rows" "$reg" <<'PY'
import json, sys
ws, rows, reg = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])
pins = reg.get("pins") or {}
pin_by_id = {v: k for k, v in pins.items()}
print(f"workspace: {ws}")
print(f"registry:  pins={list(pins.keys())} lastId={(reg.get('lastId') or '')[:8] or '-'}")
print()
if not rows:
    print("(本业务仓尚无 Codex 会话。用 orch 新开一条即可。)")
    raise SystemExit(0)
print(f"{'#':<4} {'alias':<14} {'id':<38} {'when':<22} originator  name")
for i, r in enumerate(rows, 1):
    alias = pin_by_id.get(r["id"], "")
    mark = "*" if r["id"] == reg.get("lastId") else " "
    when = (r.get("updated_at") or "")[:19].replace("T", " ")
    name = (r.get("thread_name") or "")[:24]
    print(f"{mark}{i:<3} {alias:<14} {r['id']:<38} {when:<22} {r['originator'][:12]:<12} {name}")
print()
print("恢复: orch resume            # 本仓最近 TUI")
print("      orch resume 1          # 上表序号")
print("      orch resume <uuid>")
print("      orch resume <alias>    # 先 orch session pin <alias>")
PY
}

resolve_session_id() {
  local ws="$1" key="${2:-}"
  local rows reg
  rows="$(list_sessions_json "$ws" 50)"
  reg="$(load_registry "$ws")"
  python3 - "$ws" "$rows" "$reg" "$key" <<'PY'
import json, sys
ws, rows, reg, key = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3]), sys.argv[4]
pins = reg.get("pins") or {}
if not key or key in ("last", "--last"):
    # last pinned tracker, else first tui row, else first row
    if reg.get("lastId"):
        print(reg["lastId"]); raise SystemExit(0)
    for r in rows:
        if "tui" in (r.get("originator") or ""):
            print(r["id"]); raise SystemExit(0)
    if rows:
        print(rows[0]["id"]); raise SystemExit(0)
    raise SystemExit(2)
if key in pins:
    print(pins[key]); raise SystemExit(0)
if key.isdigit():
    i = int(key)
    if 1 <= i <= len(rows):
        print(rows[i-1]["id"]); raise SystemExit(0)
    raise SystemExit(3)
# uuid prefix / full
for r in rows:
    if r["id"] == key or r["id"].startswith(key):
        print(r["id"]); raise SystemExit(0)
# global uuid even if cwd filter missed
print(key)
PY
}

remember_last() {
  local ws="$1" sid="$2"
  local reg
  reg="$(load_registry "$ws")"
  python3 -c "
import json,sys
reg=json.loads(sys.argv[1])
reg['workspace']=sys.argv[2]
reg['lastId']=sys.argv[3]
print(json.dumps(reg, ensure_ascii=False, indent=2))
" "$reg" "$ws" "$sid" >"$(reg_file "$ws")"
}

cmd_pin() {
  local name="${1:-}"
  if [[ -z "$name" ]]; then
    echo "用法: orch session pin <别名>" >&2
    exit 1
  fi
  local ws sid
  ws="$(workspace_abs)"
  sid="$(resolve_session_id "$ws" last)" || {
    echo "本仓没有可 pin 的会话" >&2
    exit 1
  }
  local reg
  reg="$(load_registry "$ws")"
  python3 -c "
import json,sys
reg=json.loads(sys.argv[1])
reg.setdefault('pins',{})[sys.argv[2]]=sys.argv[3]
reg['workspace']=sys.argv[4]
reg['lastId']=sys.argv[3]
print(json.dumps(reg, ensure_ascii=False, indent=2))
" "$reg" "$name" "$sid" "$ws" >"$(reg_file "$ws")"
  echo "已 pin: $name → $sid"
  echo "恢复: orch resume $name"
}

cmd_resume() {
  local key="${1:-last}"
  shift || true
  local ws sid
  ws="$(workspace_abs)"
  if ! sid="$(resolve_session_id "$ws" "$key")"; then
    echo "找不到会话。先: orch sessions" >&2
    exit 1
  fi
  remember_last "$ws" "$sid"

  if ! CODEX_BIN="$(resolve_codex_bin)"; then
    echo "未找到 codex" >&2
    exit 1
  fi

  export ORCHESTRATOR_ROOT="${ORCHESTRATOR_ROOT:-$ROOT}"
  export TARGET_WORKSPACE="$ws"
  export ORCHESTRATOR_TARGET_WORKSPACE="$ws"
  if [[ -x "$ROOT/scripts/set-workspace.sh" ]]; then
    bash "$ROOT/scripts/set-workspace.sh" "$ws" >/dev/null || true
  fi

  echo "resume session: $sid"
  echo "workspace:      $ws"
  echo
  # 其余参数作为开场 prompt
  if [[ $# -gt 0 ]]; then
    exec "$CODEX_BIN" resume -C "$ws" "$sid" "$*"
  else
    exec "$CODEX_BIN" resume -C "$ws" "$sid"
  fi
}

# After a fresh interactive session exits, record newest tui for this ws
cmd_capture_last() {
  local ws
  ws="$(workspace_abs)"
  local sid
  sid="$(resolve_session_id "$ws" last 2>/dev/null)" || return 0
  remember_last "$ws" "$sid"
  echo "recorded last session for workspace: $sid"
}

case "${1:-}" in
  list|ls|sessions|"")
    shift || true
    cmd_list
    ;;
  resume)
    shift
    cmd_resume "$@"
    ;;
  pin)
    shift
    cmd_pin "$@"
    ;;
  last|id)
    ws="$(workspace_abs)"
    resolve_session_id "$ws" last
    ;;
  capture)
    cmd_capture_last
    ;;
  session)
    shift
    case "${1:-}" in
      pin) shift; cmd_pin "$@" ;;
      last|id) ws="$(workspace_abs)"; resolve_session_id "$ws" last ;;
      *) cmd_list ;;
    esac
    ;;
  -h|--help)
    cat <<'EOF'
orch sessions / orch resume — 按业务仓管理 Codex 会话

  orch sessions                 列出本仓会话
  orch resume                   恢复本仓最近会话
  orch resume 1                 按列表序号
  orch resume <uuid>
  orch resume <alias>
  orch session pin <alias>      给最近会话起名

新开会话仍用: orch
EOF
    ;;
  *)
    if [[ "$1" =~ ^[0-9a-f-]{8,} || "$1" =~ ^[0-9]+$ ]]; then
      cmd_resume "$@"
    else
      echo "未知: $1（试 sessions --help）" >&2
      exit 1
    fi
    ;;
esac
