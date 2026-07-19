#!/usr/bin/env bash
# 检查本机是否已具备「Codex CLI + bridge + MCP + Skills」工作流。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

ROOT="$(orch_root)"
FAIL=0
ok() { echo "  OK  $*"; }
bad() { echo "  FAIL $*"; FAIL=1; }
warn() { echo "  WARN $*"; }

echo "doctor · $ROOT"
echo

# Node
if need_cmd node && need_cmd npm; then
  ok "node $(node -v) / npm $(npm -v | head -1)"
else
  bad "需要 node + npm"
fi

# Bridge build
if [[ -f "$ROOT/packages/bridge/dist/index.js" && -f "$ROOT/packages/bridge/dist/cli.js" ]]; then
  ok "bridge dist 已构建"
else
  bad "bridge 未构建 → cd packages/bridge && npm i && npm run build"
fi

# .env
if [[ -f "$ROOT/.env" ]]; then
  if grep -q 'sk-your-key-here\|SILICONFLOW_API_KEY=$' "$ROOT/.env" 2>/dev/null; then
    warn ".env 存在，但 SILICONFLOW_API_KEY 可能未填写（mock 执行器不需要）"
  else
    ok ".env 存在"
  fi
else
  warn "无 .env（可 cp .env.example .env）；mock 仍可跑"
fi

# Codex
if CODEX_BIN="$(resolve_codex_bin)"; then
  ok "codex → $CODEX_BIN"
else
  bad "未找到 Codex CLI"
  CODEX_BIN=""
fi

# MCP：用户级绝对路径才算「install 完成」；仅有项目内相对路径 ≠ 任意目录可用
CODEX_CFG="${CODEX_HOME:-$HOME/.codex}/config.toml"
if [[ -f "$CODEX_CFG" ]] && grep -F "$ROOT/scripts/mcp-bridge.sh" "$CODEX_CFG" >/dev/null; then
  ok "MCP opencode_bridge → $ROOT/scripts/mcp-bridge.sh（用户配置）"
elif [[ -f "$ROOT/.codex/config.toml" ]] && grep -q 'mcp-bridge\.sh' "$ROOT/.codex/config.toml"; then
  warn "仅有项目内 MCP（相对路径）。任意业务仓使用请跑: bash scripts/install.sh"
else
  bad "未注册 MCP opencode_bridge → bash scripts/install.sh"
fi

# Skills
SKILL_HOME="$HOME/.agents/skills"
for name in opencode-dispatch opencode-supervise opencode-review; do
  if [[ -L "$SKILL_HOME/$name" || -f "$SKILL_HOME/$name/SKILL.md" ]]; then
    ok "skill $name @ $SKILL_HOME/$name"
  else
    bad "缺少 skill $name → bash scripts/install.sh"
  fi
done

# Workspace
WS_JSON="$(bridge_cli "$ROOT" workspace 2>/dev/null || echo '{}')"
TW="$(echo "$WS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('targetWorkspace') or d.get('workspace') or '')" 2>/dev/null || true)"
SRC="$(echo "$WS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('source') or '')" 2>/dev/null || true)"
if [[ -n "$TW" ]]; then
  ok "target workspace: $TW (source=$SRC)"
else
  warn "尚未 set-workspace（默认 playground 演示）"
fi

# install marker
if [[ -f "$HOME/.config/codex-opencode-orchestrator/install.env" ]]; then
  ok "install 标记存在"
else
  warn "未跑过 install.sh（建议跑一次）"
fi

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "DOCTOR_OK"
  exit 0
fi
echo "DOCTOR_FAIL"
exit 1
