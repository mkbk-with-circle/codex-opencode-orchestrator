#!/usr/bin/env bash
# 设置 OpenCode 默认目标工作目录（业务项目，不是编排仓）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "用法: bash scripts/set-workspace.sh /绝对路径/到你的业务项目"
  echo "示例: bash scripts/set-workspace.sh ~/Projects/MyDesktopPet"
  exit 1
fi
# expand ~
TARGET="${TARGET/#\~/$HOME}"
TARGET="$(cd "$TARGET" && pwd)"
cd "$ROOT/packages/bridge"
npm run build >/dev/null
npx tsx src/cli.ts set-workspace --path "$TARGET"
echo
echo "之后在 Codex（打开编排仓）里 /dispatch 会默认让 OpenCode 在此目录工作。"
echo "也可在对话中: /dispatch，workspace=$TARGET"
