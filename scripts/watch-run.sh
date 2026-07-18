#!/usr/bin/env bash
# 定时轮询 run 状态（不依赖 Codex 内置定时器）。
#
# Codex CLI 本身没有 cron；本脚本用 shell 循环调 bridge：
#   - 默认只打印 status/progress
#   - --ask-on-change / --ask-on-stall 时用 `codex exec` 唤醒大脑做监督
#
# 用法:
#   bash scripts/watch-run.sh
#   bash scripts/watch-run.sh --run <id> --interval 20
#   bash scripts/watch-run.sh --until-done --interval 15
#   bash scripts/watch-run.sh --ask-on-stall 120 --interval 30
#   bash scripts/watch-run.sh --ask-on-change --once   # 单次检查
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

ROOT="$(orch_root)"
INTERVAL=30
RUN_ID=""
UNTIL_DONE=0
ONCE=0
ASK_ON_CHANGE=0
STALL_SECS=0
MAX_ITERS=0
QUIET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval) INTERVAL="${2:-30}"; shift 2 ;;
    --run) RUN_ID="${2:-}"; shift 2 ;;
    --until-done) UNTIL_DONE=1; shift ;;
    --once) ONCE=1; shift ;;
    --ask-on-change) ASK_ON_CHANGE=1; shift ;;
    --ask-on-stall) STALL_SECS="${2:-120}"; shift 2 ;;
    --max) MAX_ITERS="${2:-0}"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 1
      ;;
  esac
done

if ! [[ "$INTERVAL" =~ ^[0-9]+$ ]] || [[ "$INTERVAL" -lt 1 ]]; then
  echo "--interval 必须是正整数秒" >&2
  exit 1
fi

CODEX_BIN="$(resolve_codex_bin || true)"
LAST_FINGERPRINT=""
LAST_CHANGE_TS="$(date +%s)"
ITER=0

json_field() {
  local json="$1" expr="$2"
  echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); $expr" 2>/dev/null || true
}

ask_codex() {
  local reason="$1" status_json="$2"
  if [[ -z "${CODEX_BIN}" ]]; then
    echo "[ask] 跳过：未找到 codex" >&2
    return 0
  fi
  local prompt
  prompt="$(cat <<EOF
你是编排器大脑。定时监督唤醒（原因: ${reason}）。
请用 MCP 工具 opencode_bridge 的 status / progress（如有）查看当前 run，用一两句话汇报：
- run 状态
- 是否卡住 / 是否该 interrupt 或 rework
- 下一步建议
不要改业务代码。当前 status JSON:
\`\`\`json
${status_json}
\`\`\`
EOF
)"
  echo
  echo "[ask] codex exec · $reason"
  # -C 编排仓以便读 AGENTS；业务仓靠 TARGET_WORKSPACE / workspace.env
  "$CODEX_BIN" exec --skip-git-repo-check -C "$ROOT" -s read-only \
    "$prompt" </dev/null || echo "[ask] codex exec 退出非零（继续轮询）" >&2
}

echo "watch-run · interval=${INTERVAL}s  root=$ROOT"
[[ -n "$RUN_ID" ]] && echo "run: $RUN_ID" || echo "run: (latest)"
[[ "$ASK_ON_CHANGE" -eq 1 ]] && echo "ask-on-change: on"
[[ "$STALL_SECS" -gt 0 ]] && echo "ask-on-stall: ${STALL_SECS}s"
echo

while true; do
  ITER=$((ITER + 1))
  ARGS=(status)
  [[ -n "$RUN_ID" ]] && ARGS+=(--run "$RUN_ID")

  ST="$(bridge_cli "$ROOT" "${ARGS[@]}" 2>/dev/null || echo '{"ok":false}')"
  STATUS="$(json_field "$ST" "print((d.get('run') or {}).get('status') or d.get('status') or 'unknown')")"
  RID="$(json_field "$ST" "print((d.get('run') or {}).get('id') or d.get('runId') or '')")"
  PROG="$(json_field "$ST" "p=(d.get('poll') or {}).get('progress') or (d.get('run') or {}).get('lastProgress') or ''; print(p[:160])")"
  FP="${STATUS}|${PROG}"

  NOW="$(date +%s)"
  TS="$(date '+%H:%M:%S')"
  if [[ "$QUIET" -eq 0 ]]; then
    echo "[$TS] #$ITER  run=${RID:-?}  status=$STATUS  progress=${PROG:-—}"
  fi

  if [[ "$FP" != "$LAST_FINGERPRINT" ]]; then
    if [[ -n "$LAST_FINGERPRINT" && "$ASK_ON_CHANGE" -eq 1 ]]; then
      ask_codex "status/progress changed" "$ST"
    fi
    LAST_FINGERPRINT="$FP"
    LAST_CHANGE_TS="$NOW"
  elif [[ "$STALL_SECS" -gt 0 ]]; then
    idle=$((NOW - LAST_CHANGE_TS))
    if [[ "$idle" -ge "$STALL_SECS" ]]; then
      ask_codex "stalled ${idle}s without progress change" "$ST"
      LAST_CHANGE_TS="$NOW"
    fi
  fi

  case "$STATUS" in
    completed|failed|interrupted|cancelled|error)
      if [[ "$UNTIL_DONE" -eq 1 || "$ONCE" -eq 1 ]]; then
        echo "终端状态: $STATUS"
        exit 0
      fi
      ;;
  esac

  [[ "$ONCE" -eq 1 ]] && exit 0
  if [[ "$MAX_ITERS" -gt 0 && "$ITER" -ge "$MAX_ITERS" ]]; then
    echo "达到 --max $MAX_ITERS，退出"
    exit 0
  fi
  sleep "$INTERVAL"
done
