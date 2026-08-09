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

secure_state_dir() {
  local dir="$1"
  mkdir -p "$dir"
  chmod 700 "$dir"
}

link_managed_path() {
  local source="$1" target="$2"
  if [[ -e "$target" && ! -L "$target" ]]; then
    return 2
  fi
  [[ -L "$target" ]] && rm -- "$target"
  ln -s "$source" "$target"
}

pid_matches_script() {
  local pid="$1" expected="$2" command_line
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [[ "$pid" -gt 1 ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ -n "$command_line" && "$command_line" == *"$expected"* ]]
}

stop_managed_process() {
  local pid="$1" expected="$2"
  pid_matches_script "$pid" "$expected" || return 1
  kill "$pid" 2>/dev/null || return 1
  for _ in {1..20}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  pid_matches_script "$pid" "$expected" || return 0
  kill -9 "$pid" 2>/dev/null || return 1
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
