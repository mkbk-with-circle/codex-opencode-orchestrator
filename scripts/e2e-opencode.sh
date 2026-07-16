#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ORCHESTRATOR_ROOT="$ROOT"
export PATH="$HOME/.opencode/bin:$PATH"
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

cd "$ROOT/packages/bridge"
npm run build >/dev/null

# Reset playground hello for a clean demo (main tree; worktree starts from HEAD so commit first ideally)
# For e2e we disable worktree via env override in a temp config? Use --extra and executor; worktree copies from HEAD.
# Ensure repo has at least one commit so worktree works.
cd "$ROOT"
if ! git rev-parse HEAD >/dev/null 2>&1; then
  git add -A
  git -c user.email="orchestrator@local" -c user.name="Orchestrator" commit -m "chore: initial scaffold" --allow-empty || true
fi

echo "== start/check opencode serve =="
if ! curl -sf "http://127.0.0.1:4096/global/health" >/dev/null 2>&1; then
  opencode serve --port 4096 --hostname 127.0.0.1 >/tmp/opencode-serve.log 2>&1 &
  echo $! >/tmp/opencode-serve.pid
  for i in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:4096/global/health" >/dev/null 2>&1; then
      echo "serve up"
      break
    fi
    sleep 0.5
  done
fi
curl -sf "http://127.0.0.1:4096/global/health" || { echo "serve failed"; cat /tmp/opencode-serve.log || true; exit 1; }

cd "$ROOT/packages/bridge"
echo "== siliconflow-opencode dispatch =="
# confirm off for automation; use_worktree still on from yaml
OUT=$(npx tsx src/cli.ts dispatch --no-confirm --executor siliconflow-opencode)
echo "$OUT"
RUN_ID=$(echo "$OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['runId'])")

echo "== poll until idle/completed (max ~120s) =="
for i in $(seq 1 40); do
  ST=$(npx tsx src/cli.ts status --run "$RUN_ID")
  echo "$ST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['run']['status'], (d.get('poll') or {}).get('progress','')[:120])"
  STATUS=$(echo "$ST" | python3 -c "import sys,json; print(json.load(sys.stdin)['run']['status'])")
  if [[ "$STATUS" == "completed" || "$STATUS" == "failed" || "$STATUS" == "interrupted" ]]; then
    break
  fi
  sleep 3
done

WT=$(echo "$OUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('worktreePath',''))")
TARGET="$ROOT/playground/hello.txt"
if [[ -n "$WT" && -f "$ROOT/$WT/playground/hello.txt" ]]; then
  TARGET="$ROOT/$WT/playground/hello.txt"
fi
echo "== check $TARGET =="
cat "$TARGET" || true
if grep -q "Hello from OpenCode" "$TARGET"; then
  echo "E2E_OK"
  exit 0
else
  echo "E2E_PENDING_OR_FAIL (file may still be updating; inspect OpenCode session)"
  npx tsx src/cli.ts review --run "$RUN_ID" | head -c 2000
  exit 1
fi
