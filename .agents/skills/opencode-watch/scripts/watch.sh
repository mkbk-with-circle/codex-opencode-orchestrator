#!/usr/bin/env bash
# Codex 调用入口：.agents/skills/opencode-watch/scripts/watch.sh
# → 转发到仓库 scripts/watch-run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
exec bash "$ROOT/scripts/watch-run.sh" "$@"
