#!/usr/bin/env bash
# 在「当前业务目录」用 Codex CLI，并挂上编排仓环境变量。
#
#   orch / bash scripts/codex-in-workspace.sh          # 新会话
#   orch resume | bash …/codex-in-workspace.sh resume  # 恢复本仓会话
#   orch sessions                                      # 列出本仓会话
#   bash …/codex-in-workspace.sh exec '…'              # 非交互
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

ORCH_DEFAULT="$(orch_root)"
export ORCHESTRATOR_ROOT="${ORCHESTRATOR_ROOT:-$ORCH_DEFAULT}"
export TARGET_WORKSPACE="${TARGET_WORKSPACE:-$PWD}"
export ORCHESTRATOR_TARGET_WORKSPACE="$TARGET_WORKSPACE"

if ! CODEX_BIN="$(resolve_codex_bin)"; then
  echo "未找到 codex。请先: bash \"$ORCHESTRATOR_ROOT/scripts/install.sh\"" >&2
  echo "或: npm i -g @openai/codex  /  brew install --cask codex" >&2
  exit 1
fi

echo "codex:        $CODEX_BIN"
echo "orchestrator: $ORCHESTRATOR_ROOT"
echo "workspace:    $TARGET_WORKSPACE"
# 默认便宜模型（可用 CODEX_MODEL / CODEX_REASONING_EFFORT 覆盖）
CODEX_MODEL="${CODEX_MODEL:-gpt-5.6-luna}"
CODEX_REASONING_EFFORT="${CODEX_REASONING_EFFORT:-low}"
echo "codex model:  $CODEX_MODEL ($CODEX_REASONING_EFFORT)"
echo

# Sync user workspace.env for bridge/MCP
if [[ -x "$ORCHESTRATOR_ROOT/scripts/set-workspace.sh" ]]; then
  bash "$ORCHESTRATOR_ROOT/scripts/set-workspace.sh" "$TARGET_WORKSPACE" >/dev/null || true
fi

MODE="${1:-}"

case "$MODE" in
  exec)
    shift
    PROMPT="${*:-Reply with PONG only.}"
    exec "$CODEX_BIN" exec --skip-git-repo-check \
      -m "$CODEX_MODEL" \
      -c "model_reasoning_effort=\"${CODEX_REASONING_EFFORT}\"" \
      -C "$TARGET_WORKSPACE" \
      "$PROMPT" </dev/null
    ;;
  resume|sessions|session)
    exec bash "$ORCHESTRATOR_ROOT/scripts/sessions.sh" "$@"
    ;;
  -h|--help)
    cat <<EOF
用法:
  $(basename "$0")                 在本业务仓开新 Codex 会话
  $(basename "$0") resume          恢复本仓最近会话
  $(basename "$0") resume <id|名|#>
  $(basename "$0") sessions        列出本仓会话
  $(basename "$0") exec 'prompt'   非交互

等价: orch / orch resume / orch sessions
默认 Codex 模型: gpt-5.6-luna / low（可用环境变量 CODEX_MODEL、CODEX_REASONING_EFFORT 覆盖）
EOF
    exit 0
    ;;
esac

echo "提示: 下次恢复本仓会话 → orch resume   | 列表 → orch sessions"
echo "      给当前会话起名   → 退出后 orch session pin <别名>"
echo

# Interactive: after exit, capture last session id for this workspace
"$CODEX_BIN" -C "$TARGET_WORKSPACE" \
  -m "$CODEX_MODEL" \
  -c "model_reasoning_effort=\"${CODEX_REASONING_EFFORT}\"" \
  "$@" || status=$?
status=${status:-0}
bash "$ORCHESTRATOR_ROOT/scripts/sessions.sh" capture >/dev/null 2>&1 || true
exit "$status"
