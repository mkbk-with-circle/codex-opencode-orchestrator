#!/usr/bin/env bash
# Consume durable v2 events and wake a dedicated Codex supervisor session.
set -euo pipefail

SCRIPT_DIR="${SUPERVISOR_SCRIPT_DIR:?}"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

ROOT="${SUPERVISOR_ROOT:?}"
RUN_ID="${SUPERVISOR_RUN_ID:?}"
SESSION_ID="${SUPERVISOR_SESSION_ID:?}"
INTERVAL="${SUPERVISOR_INTERVAL:?}"
PID_FILE="${SUPERVISOR_PID_FILE:?}"

echo "$$" >"$PID_FILE"
echo "$(date -Iseconds) supervisor start run=$RUN_ID session=$SESSION_ID interval=${INTERVAL}s"

while true; do
  if [[ ! -f "$PID_FILE" ]] || [[ "$(sed -n '1p' "$PID_FILE" 2>/dev/null || true)" != "$$" ]]; then
    exit 0
  fi

  pending="$(bridge_cli "$ROOT" events-pending --run "$RUN_ID" 2>/dev/null || true)"
  event="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const e=(JSON.parse(s).events||[])[0];if(e)process.stdout.write(JSON.stringify(e))}catch{}})' <<<"$pending")"

  if [[ -n "$event" ]]; then
    prompt="$(node - "$event" <<'JS'
const e = JSON.parse(process.argv[2]);
process.stdout.write(`【Orchestrator v2 supervisor event】
Run: ${e.runId}
Event: ${JSON.stringify(e)}

Act as Codex supervisor, not executor.
- For phase.implemented: call review_context_v2 for this exact phase, independently inspect files and run its acceptance checks, then call review_phase with accept/rework/needs_user.
- For phase.blocked or phase.attempt_failed: inspect status and decide retry or ask the human. Never guess credentials or product decisions.
- For protocol.violation: keep the run paused and report the violation.
- If a phase is accepted and a new window becomes authorized, call dispatch_window_v2 to continue OpenCode. Do not dispatch when a hold is open.
- Only after the event was handled successfully, call ack_event_v2 with seq=${e.seq}.
- Never mark the overall run complete until every phase is accepted and final acceptance passes.
`);
JS
)"
    if CODEX_BIN="$(resolve_codex_bin)"; then
      "$CODEX_BIN" exec resume --skip-git-repo-check "$SESSION_ID" "$prompt" </dev/null || true
    fi
  else
    run_status="$(bridge_cli "$ROOT" run-status --run "$RUN_ID" 2>/dev/null || true)"
    terminal="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s).run.status;if(["completed","cancelled","failed"].includes(v))process.stdout.write(v)}catch{}})' <<<"$run_status")"
    if [[ -n "$terminal" ]]; then
      echo "$(date -Iseconds) supervisor stop run=$RUN_ID status=$terminal"
      : >"$PID_FILE"
      exit 0
    fi
  fi
  sleep "$INTERVAL"
done
