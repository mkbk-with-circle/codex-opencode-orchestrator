#!/usr/bin/env bash
# MCP entry: resolve absolute repo root so Codex App cwd quirks don't break node
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ORCHESTRATOR_ROOT="$ROOT"
export PATH="$HOME/.opencode/bin:$PATH"
# Load .env into environment for OpenCode child if needed
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
exec node "$ROOT/packages/bridge/dist/index.js"
