#!/usr/bin/env bash
# Shared helpers for installer / doctor / poll.
# shellcheck disable=SC2034

orch_root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  echo "$here"
}

resolve_codex_bin() {
  if [[ -n "${CODEX_BIN:-}" && -x "${CODEX_BIN}" ]]; then
    echo "$CODEX_BIN"
    return 0
  fi
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return 0
  fi
  if [[ -x /Applications/ChatGPT.app/Contents/Resources/codex ]]; then
    echo "/Applications/ChatGPT.app/Contents/Resources/codex"
    return 0
  fi
  if [[ -x /Applications/Codex.app/Contents/Resources/codex ]]; then
    echo "/Applications/Codex.app/Contents/Resources/codex"
    return 0
  fi
  return 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令: $1" >&2
    return 1
  }
}

bridge_cli() {
  local root="$1"
  shift
  (
    cd "$root/packages/bridge"
    if [[ -f dist/cli.js ]]; then
      node dist/cli.js "$@"
    else
      npx tsx src/cli.ts "$@"
    fi
  )
}
