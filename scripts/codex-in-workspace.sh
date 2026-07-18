#!/usr/bin/env bash
# 在「当前业务目录」用 Codex CLI，并挂上编排仓环境变量。
# 用法:
#   cd ~/Projects/MyApp
#   bash /path/to/codex-opencode-orchestrator/scripts/codex-in-workspace.sh
#   bash .../codex-in-workspace.sh exec '列出当前目录文件，不要改任何东西'
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
echo

# Sync user workspace.env for bridge/MCP
if [[ -x "$ORCHESTRATOR_ROOT/scripts/set-workspace.sh" ]]; then
  bash "$ORCHESTRATOR_ROOT/scripts/set-workspace.sh" "$TARGET_WORKSPACE" >/dev/null || true
fi

MODE="${1:-}"
if [[ "$MODE" == "exec" ]]; then
  shift
  PROMPT="${*:-Reply with PONG only.}"
  exec "$CODEX_BIN" exec --skip-git-repo-check \
    -C "$TARGET_WORKSPACE" \
    "$PROMPT" </dev/null
fi

exec "$CODEX_BIN" -C "$TARGET_WORKSPACE" "$@"
