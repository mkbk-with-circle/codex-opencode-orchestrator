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
if [[ -f "$ROOT/packages/bridge/dist/index.js" && -f "$ROOT/packages/bridge/dist/executor-index.js" && -f "$ROOT/packages/bridge/dist/cli.js" ]]; then
  ok "bridge dist 已构建"
else
  bad "bridge 未构建 → cd packages/bridge && npm i && npm run build"
fi

# v2 unit/integration tests
if (cd "$ROOT/packages/bridge" && npm test >/dev/null 2>&1); then
  ok "v2 tests"
else
  bad "v2 tests 失败 → cd packages/bridge && npm test"
fi

# OpenCode (only required for real executor runs)
if [[ -n "${OPENCODE_BIN:-}" && -x "${OPENCODE_BIN}" ]]; then
  ok "opencode $(${OPENCODE_BIN} --version 2>/dev/null | head -1) @ $OPENCODE_BIN"
elif [[ -n "${OPENCODE_BIN:-}" ]]; then
  bad "OPENCODE_BIN 不可执行: $OPENCODE_BIN"
elif command -v opencode >/dev/null 2>&1; then
  ok "opencode $(opencode --version 2>/dev/null | head -1)"
elif [[ -x "$HOME/.opencode/bin/opencode" ]]; then
  ok "opencode $($HOME/.opencode/bin/opencode --version 2>/dev/null | head -1) @ ~/.opencode/bin"
else
  warn "未找到 OpenCode CLI（mock 可用；真实 Run 前执行 scripts/setup-opencode.sh）"
fi

for script in supervisor-v2.sh supervisor-v2-daemon.sh mcp-executor.sh; do
  if [[ -f "$ROOT/scripts/$script" ]] && bash -n "$ROOT/scripts/$script"; then
    ok "$script"
  else
    bad "$script 缺失或语法错误"
  fi
done

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

HOOK_CFG="${CODEX_HOME:-$HOME/.codex}/hooks.json"
if [[ -f "$HOOK_CFG" ]] && grep -Fq 'codex-opencode execution authority guard' "$HOOK_CFG"; then
  ok "Codex execution authority hook 已安装"
else
  bad "缺少 Codex execution authority hook → bash scripts/install.sh"
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
TW="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const x=JSON.parse(s);process.stdout.write(x.targetWorkspace||x.workspace||"")}catch{}})' <<<"$WS_JSON")"
SRC="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).source||"")}catch{}})' <<<"$WS_JSON")"
if [[ -n "$TW" ]]; then
  ok "target workspace: $TW (source=$SRC)"
  if [[ -d "$TW/.git" ]]; then
    ok "target workspace 是 Git root"
  else
    warn "v2 Run 需要 Git root；执行前在目标目录运行 git init"
  fi
else
  warn "尚未 set-workspace（默认 playground 演示）"
fi

MODEL_CHECK="$(bridge_cli "$ROOT" model-check 2>/dev/null || true)"
MODEL_OK="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{if(JSON.parse(s).ok)process.stdout.write("yes")}catch{}})' <<<"$MODEL_CHECK")"
if [[ "$MODEL_OK" == "yes" ]]; then
  ok "active OpenCode model/profile ready"
else
  warn "active OpenCode model/profile 未就绪 → orch model check"
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
