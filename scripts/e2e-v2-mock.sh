#!/usr/bin/env bash
# Deterministic v2 control-plane E2E. It simulates executor reports; it never calls a model.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"
ROOT="$(orch_root)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/orch-v2-e2e.XXXXXX")"
trap 'find "$WORK" -depth -delete 2>/dev/null || true' EXIT

git -C "$WORK" init -q
git -C "$WORK" config user.email e2e@example.invalid
git -C "$WORK" config user.name "Orchestrator E2E"
mkdir -p "$WORK/.orchestrator/plans"
touch "$WORK/seed"
git -C "$WORK" add seed
git -C "$WORK" commit -qm seed

PLAN="$WORK/.orchestrator/plans/e2e.md"
node - "$PLAN" "$WORK" <<'JS'
const fs = require("node:fs");
const planPath = process.argv[2];
const workspace = process.argv[3];
fs.writeFileSync(planPath, `---
workspace: ${workspace}
task: e2e
status: draft
executionMode: strict
batchSize: 1
---

# v2 mock e2e

## 整个项目必须遵循的硬性规定
1. Never push.

## 步骤
- [ ] P01 — create output
  - 允许修改：**/*
  - 验收命令：\`test -f output.txt\`
  <!-- OPENCODE REPORT P01 START -->
  status: pending
  comment:
  evidence:
  <!-- OPENCODE REPORT P01 END -->

- [ ] P02 — verify content
  - 依赖：P01 accepted
  - 允许修改：**/*
  - 验收命令：\`grep -q harness output.txt\`
  <!-- OPENCODE REPORT P02 START -->
  status: pending
  comment:
  evidence:
  <!-- OPENCODE REPORT P02 END -->

## 总体验收命令
- 验收：\`test "$(cat output.txt)" = harness\`
`);
JS

bridge() {
  ORCHESTRATOR_TARGET_WORKSPACE="$WORK" TARGET_WORKSPACE="$WORK" bridge_cli "$ROOT" "$@"
}

bridge plan-approve --plan e2e >/dev/null
started="$(bridge run-start --plan e2e --executor mock --mode strict)"
run_id="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).run.id))' <<<"$started")"
bridge run-dispatch --run "$run_id" >/dev/null

bridge phase-start --run "$run_id" --phase P01 >/dev/null
echo harness >"$WORK/output.txt"
bridge phase-report --run "$run_id" --phase P01 --outcome complete --comment created --evidence file >/dev/null
bridge phase-acceptance --run "$run_id" --phase P01 >/dev/null
bridge phase-review --run "$run_id" --phase P01 --verdict accept --summary verified >/dev/null

bridge phase-start --run "$run_id" --phase P02 >/dev/null
bridge phase-report --run "$run_id" --phase P02 --outcome complete --comment verified --evidence grep >/dev/null
bridge phase-acceptance --run "$run_id" --phase P02 >/dev/null
bridge phase-review --run "$run_id" --phase P02 --verdict accept --summary verified >/dev/null
bridge run-complete --run "$run_id" --note E2E_PASS >/dev/null

status="$(bridge run-status --run "$run_id")"
node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(x.run.status!=="completed"||!x.phases.every(p=>p.status==="accepted"))process.exit(1);console.log("E2E_V2_MOCK_OK",x.run.id)})' <<<"$status"
