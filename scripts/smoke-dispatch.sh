#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ORCHESTRATOR_ROOT="$ROOT"
export PATH="$HOME/.opencode/bin:$PATH"

cd "$ROOT/packages/bridge"
npm run build >/dev/null

echo "== mock dispatch (no confirm) =="
OUT=$(npx tsx src/cli.ts dispatch --no-confirm --executor mock)
echo "$OUT"
RUN_ID=$(echo "$OUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('runId',''))")

echo "== status =="
npx tsx src/cli.ts status --run "$RUN_ID"

echo "== progress =="
npx tsx src/cli.ts progress --run "$RUN_ID"

echo "== review_context (truncated) =="
npx tsx src/cli.ts review --run "$RUN_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok', d.get('ok')); print('status', d.get('run',{}).get('status')); print('acceptance', d.get('acceptanceCommands'))"

WT=$(echo "$OUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('worktreePath',''))")
if [[ -n "$WT" && -f "$ROOT/$WT/playground/hello.txt" ]]; then
  echo "== worktree hello.txt =="
  cat "$ROOT/$WT/playground/hello.txt"
fi

echo "SMOKE_OK"
