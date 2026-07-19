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
need_cmd python3

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
  npm run build
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

# --- 便捷入口标记 ---
MARKER="$HOME/.config/codex-opencode-orchestrator"
mkdir -p "$MARKER"
echo "ORCHESTRATOR_ROOT=$ROOT" >"$MARKER/install.env"
echo "INSTALLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$MARKER/install.env"
echo "CODEX_BIN=$CODEX_BIN" >>"$MARKER/install.env"

# shell wrapper hint
WRAPPER="$ROOT/bin/orch"
chmod +x "$ROOT/scripts/"*.sh "$ROOT/bin/"* 2>/dev/null || true

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
echo "安装完成。下一步："
echo
echo "  # 1) 指定业务项目（OpenCode 真正改代码的地方）"
echo "  bash $ROOT/scripts/set-workspace.sh ~/Projects/YourApp"
echo
echo "  # 2) 在业务仓启动 Codex（或任意目录）"
echo "  cd ~/Projects/YourApp"
echo "  bash $ROOT/scripts/codex-in-workspace.sh"
echo
echo "  # 3) 对话里用 /dispatch /status /review（Skills 已链到 ~/.agents/skills）"
echo
echo "  # 定时轮询（只要两个）:"
echo "  bash $ROOT/bin/orch poll start --interval 60"
echo "  bash $ROOT/bin/orch poll stop"
echo
echo "  健康检查: bash $ROOT/scripts/doctor.sh"
echo "  说明:     $ROOT/docs/USAGE.md"
echo "────────────────────────────────────────"
echo "可选: 把下面加到 ~/.zshrc"
echo "  export PATH=\"$ROOT/bin:\$PATH\""
echo "  # 然后任意目录: orch   /  orch resume   /  orch poll start|stop"
echo "────────────────────────────────────────"
