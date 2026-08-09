#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
export LANG=C

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/orch-safety.XXXXXX")"
managed_pid=""
unrelated_pid=""
cleanup() {
  if [[ -n "$managed_pid" ]]; then
    kill "$managed_pid" 2>/dev/null || true
    wait "$managed_pid" 2>/dev/null || true
  fi
  if [[ -n "$unrelated_pid" ]]; then
    kill "$unrelated_pid" 2>/dev/null || true
    wait "$unrelated_pid" 2>/dev/null || true
  fi
  rm -rf -- "$TEST_DIR"
}
trap cleanup EXIT

mode_of() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

state_dir="$TEST_DIR/state"
secure_state_dir "$state_dir"
[[ "$(mode_of "$state_dir")" == "700" ]]

source_dir="$TEST_DIR/source"
target="$TEST_DIR/target"
mkdir -p "$source_dir" "$target"
if link_managed_path "$source_dir" "$target"; then
  echo "link_managed_path overwrote a real directory" >&2
  exit 1
fi
[[ -d "$target" && ! -L "$target" ]]
rmdir "$target"
link_managed_path "$source_dir" "$target"
[[ -L "$target" ]]

marker="$SCRIPT_DIR/supervisor-v2-daemon.sh"
bash -c 'trap "exit 0" TERM; while :; do sleep 1; done' "$marker" &
managed_pid=$!
sleep 0.1
pid_matches_script "$managed_pid" "$marker"
stop_managed_process "$managed_pid" "$marker"
managed_pid=""

sleep 30 &
unrelated_pid=$!
if pid_matches_script "$unrelated_pid" "$marker"; then
  echo "unrelated PID matched managed script" >&2
  exit 1
fi
if stop_managed_process "$unrelated_pid" "$marker"; then
  echo "unrelated PID was stopped" >&2
  exit 1
fi
kill -0 "$unrelated_pid"

if grep -nF 'rm -rf "$target"' "$SCRIPT_DIR/install.sh" >/dev/null; then
  echo "installer still recursively removes skill targets" >&2
  exit 1
fi

fixture_dir="$TEST_DIR/opencode-fixture"
fixture_archive="$TEST_DIR/opencode-test.tar.gz"
fixture_bin="$TEST_DIR/opencode-bin"
mkdir -p "$fixture_dir"
printf '%s\n' '#!/usr/bin/env bash' 'echo opencode-safety-fixture' >"$fixture_dir/opencode"
chmod 755 "$fixture_dir/opencode"
tar -czf "$fixture_archive" -C "$fixture_dir" opencode
if command -v shasum >/dev/null 2>&1; then
  fixture_sha="$(shasum -a 256 "$fixture_archive" | awk '{print $1}')"
else
  fixture_sha="$(sha256sum "$fixture_archive" | awk '{print $1}')"
fi
PATH="/usr/bin:/bin" \
HOME="$TEST_DIR/home" \
OPENCODE_BIN_DIR="$fixture_bin" \
OPENCODE_ASSET="opencode-test.tar.gz" \
OPENCODE_DOWNLOAD_URL="file://$fixture_archive" \
OPENCODE_SHA256="$fixture_sha" \
bash "$SCRIPT_DIR/setup-opencode.sh" >/dev/null 2>&1
[[ "$("$fixture_bin/opencode")" == "opencode-safety-fixture" ]]

echo "SAFETY_SMOKE_OK"
