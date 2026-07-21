#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ORCHESTRATOR_ROOT="$ROOT"
export PATH="$HOME/.opencode/bin:$PATH"
# Clear env bind so set-workspace is the source of truth for smoke
unset TARGET_WORKSPACE ORCHESTRATOR_TARGET_WORKSPACE || true

cd "$ROOT/packages/bridge"
npm run build >/dev/null

echo "== bind playground =="
npx tsx src/cli.ts set-workspace --path "$ROOT/playground"

echo "== write demo plan into bound workspace =="
# Demo plan lives under the bound workspace (playground), not orchestrator plans/
npx tsx src/cli.ts write-plan --task current --file "$ROOT/playground/.orchestrator/plans/current.md" --overwrite

echo "== mock dispatch (no confirm) =="
OUT=$(npx tsx src/cli.ts dispatch --no-confirm --executor mock --plan current.md)
echo "$OUT"
RUN_ID=$(echo "$OUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('runId',''))")

echo "== status =="
npx tsx src/cli.ts status --run "$RUN_ID"

echo "== progress =="
npx tsx src/cli.ts progress --run "$RUN_ID"

echo "== review_context (truncated) =="
npx tsx src/cli.ts review --run "$RUN_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok', d.get('ok')); print('status', d.get('run',{}).get('status')); print('workspace', d.get('workspace')); print('acceptance', d.get('acceptanceCommands'))"

WT=$(echo "$OUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('worktreePath',''))")
# worktree 在业务仓 .orchestrator/runs/<id>/worktree 下
if [[ -n "$WT" && -f "$ROOT/playground/$WT/playground/hello.txt" ]]; then
  echo "== worktree hello.txt =="
  cat "$ROOT/playground/$WT/playground/hello.txt"
elif [[ -n "$RUN_ID" && -f "$ROOT/playground/.orchestrator/runs/$RUN_ID/state.json" ]]; then
  echo "== run state =="
  python3 -c "import json;print(json.load(open('$ROOT/playground/.orchestrator/runs/$RUN_ID/state.json'))['status'])"
fi

echo "SMOKE_OK"
