#!/usr/bin/env bash
# Clone 后跑一次：构建 bridge、注册 Codex CLI MCP、安装 Skills、可选 smoke。
# 用法:
#   bash scripts/install.sh
#   bash scripts/install.sh --smoke
#   bash scripts/install.sh --workspace ~/Projects/MyApp
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

ROOT="$(orch_root)"
DO_SMOKE=0
WORKSPACE=""
SKIP_MCP=0
SKIP_SKILLS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --smoke) DO_SMOKE=1; shift ;;
    --workspace) WORKSPACE="${2:-}"; shift 2 ;;
    --skip-mcp) SKIP_MCP=1; shift ;;
    --skip-skills) SKIP_SKILLS=1; shift ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 1
      ;;
  esac
done

echo "== Codex ↔ OpenCode Orchestrator · install =="
echo "root: $ROOT"
echo

need_cmd node
need_cmd npm

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "需要 Node >= 18（当前 $(node -v)）" >&2
  exit 1
fi

# --- .env ---
if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "已创建 .env（从 .env.example）。按需填 SILICONFLOW_API_KEY。"
else
  echo "保留已有 .env"
fi

# --- bridge ---
echo
echo "== build bridge =="
(
  cd "$ROOT/packages/bridge"
  npm install
  npm run check
)

# --- codex ---
echo
echo "== resolve Codex CLI =="
if CODEX_BIN="$(resolve_codex_bin)"; then
  echo "codex: $CODEX_BIN ($("$CODEX_BIN" --version 2>/dev/null | head -1 || true))"
else
  echo "未找到 codex。" >&2
  echo "请先安装其一：" >&2
  echo "  npm i -g @openai/codex" >&2
  echo "  brew install --cask codex" >&2
  echo "  或安装 ChatGPT / Codex 桌面端（自带 CLI）" >&2
  exit 1
fi

# --- MCP（用户级绝对路径，任意 cwd 可用）---
if [[ "$SKIP_MCP" -eq 0 ]]; then
  echo
  echo "== register MCP opencode_bridge (user config) =="
  # 旧条目可能是相对路径，先移除再加
  "$CODEX_BIN" mcp remove opencode_bridge >/dev/null 2>&1 || true
  "$CODEX_BIN" mcp add opencode_bridge \
    --env "ORCHESTRATOR_ROOT=$ROOT" \
    -- bash "$ROOT/scripts/mcp-bridge.sh"
  echo "已写入 ~/.codex/config.toml → mcp_servers.opencode_bridge"
  "$CODEX_BIN" mcp get opencode_bridge 2>/dev/null || "$CODEX_BIN" mcp list 2>/dev/null | head -20 || true
fi

# --- Skills → ~/.agents/skills（任意业务仓可 $dispatch）---
if [[ "$SKIP_SKILLS" -eq 0 ]]; then
  echo
  echo "== link skills → ~/.agents/skills =="
  SKILL_HOME="${HOME}/.agents/skills"
  mkdir -p "$SKILL_HOME"
  for skill_dir in "$ROOT/.agents/skills"/*; do
    [[ -d "$skill_dir" ]] || continue
    name="$(basename "$skill_dir")"
    target="$SKILL_HOME/$name"
    if [[ -e "$target" || -L "$target" ]]; then
      rm -rf "$target"
    fi
    ln -sfn "$skill_dir" "$target"
    echo "  linked $name → $target"
  done
fi

# --- 可选业务仓 ---
if [[ -n "$WORKSPACE" ]]; then
  echo
  echo "== set workspace =="
  bash "$ROOT/scripts/set-workspace.sh" "$WORKSPACE"
fi

# --- 把 orch 永久加入 PATH（zsh/bash）---
echo
echo "== PATH: orch CLI =="
chmod +x "$ROOT/bin/"* "$ROOT/scripts/"*.sh 2>/dev/null || true
ensure_path_line() {
  local rc="$1"
  local line="export PATH=\"$ROOT/bin:\$PATH\""
  local mark="# codex-opencode-orchestrator orch CLI"
  [[ -f "$rc" ]] || touch "$rc"
  if grep -Fq "codex-opencode-orchestrator/bin" "$rc" 2>/dev/null || grep -Fq "$ROOT/bin" "$rc" 2>/dev/null; then
    echo "  已存在于 $rc"
    return 0
  fi
  {
    echo ""
    echo "$mark"
    echo "$line"
  } >>"$rc"
  echo "  已写入 $rc"
}
SHELL_NAME="$(basename "${SHELL:-zsh}")"
case "$SHELL_NAME" in
  bash) ensure_path_line "$HOME/.bashrc"; ensure_path_line "$HOME/.bash_profile" ;;
  *) ensure_path_line "$HOME/.zshrc" ;;
esac
echo "  当前终端请执行: export PATH=\"$ROOT/bin:\$PATH\"  或新开一个终端"
echo "  验证: command -v orch && orch help"

# --- 便捷入口标记 ---
MARKER="$HOME/.config/codex-opencode-orchestrator"
mkdir -p "$MARKER"
echo "ORCHESTRATOR_ROOT=$ROOT" >"$MARKER/install.env"
echo "INSTALLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$MARKER/install.env"
echo "CODEX_BIN=$CODEX_BIN" >>"$MARKER/install.env"

echo
echo "== doctor =="
bash "$ROOT/scripts/doctor.sh" || true

if [[ "$DO_SMOKE" -eq 1 ]]; then
  echo
  echo "== smoke (mock) =="
  bash "$ROOT/scripts/smoke-dispatch.sh"
fi

echo
echo "────────────────────────────────────────"
echo "安装完成。请用 orch（不要用长 bash 路径）："
echo
echo "  # 若本终端还找不到 orch："
echo "  export PATH=\"$ROOT/bin:\$PATH\""
echo "  # 或新开终端（已写入 shell rc）"
echo
echo "  orch workspace ~/Projects/YourApp   # 绑定业务仓"
echo "  cd ~/Projects/YourApp && orch      # 开对话"
echo "  orch resume                        # 下次恢复"
echo "  orch watch start / orch watch stop"
echo "  orch doctor"
echo
echo "  说明: $ROOT/docs/USAGE.md"
echo "────────────────────────────────────────"
