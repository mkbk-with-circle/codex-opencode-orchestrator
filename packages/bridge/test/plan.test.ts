import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  approvePlan,
  approvalLockPath,
  assertPlanIntegrity,
  migratePlanV1,
  parsePlan,
  updateCodexReview,
  updateExecutorReport,
  validatePlan,
} from "../src/v2/plan.js";
import { planFixture, tempWorkspace } from "./helpers.js";

test("plan v2 approves, freezes contract, and permits controlled reports", () => {
  const workspace = tempWorkspace();
  const file = planFixture(workspace);
  assert.equal(validatePlan(file).ok, true);
  const approved = approvePlan(file);
  assert.equal(approved.metadata.status, "approved");
  assert.ok(approved.metadata.planId);
  assert.ok(approved.metadata.specHash);
  assert.equal(approved.phases.length, 2);
  assert.equal(fs.existsSync(approvalLockPath(file)), true);
  assert.equal(fs.existsSync(file.replace(/\.md$/i, ".lock.json")), false);

  const afterReport = updateExecutorReport(file, "P01", {
    status: "implemented",
    comment: "created one",
    evidence: ["test passed"],
  }, true);
  assert.equal(afterReport.phases[0].checked, true);
  assert.equal(afterReport.phases[0].report.status, "implemented");

  const afterReview = updateCodexReview(file, {
    verdict: "accept",
    phaseId: "P01",
    summary: "verified",
  });
  assert.equal(afterReview.metadata.specHash, approved.metadata.specHash);
  assert.doesNotThrow(() => assertPlanIntegrity(file));
});

test("review rework clears executor checkbox without changing contract hash", () => {
  const workspace = tempWorkspace();
  const file = planFixture(workspace);
  approvePlan(file);
  updateExecutorReport(file, "P01", {
    status: "implemented",
    comment: "done",
    evidence: [],
  }, true);
  const plan = updateCodexReview(file, {
    verdict: "rework",
    phaseId: "P01",
    summary: "missing test",
    gaps: ["add test"],
  });
  assert.equal(plan.phases[0].checked, false);
  assert.doesNotThrow(() => assertPlanIntegrity(file));
});

test("contract edits are rejected after approval", () => {
  const workspace = tempWorkspace();
  const file = planFixture(workspace);
  approvePlan(file);
  fs.appendFileSync(file, "\n## Extra scope\nunauthorized\n");
  assert.throws(() => assertPlanIntegrity(file), /plan_contract_modified/);
});

test("invalid execution settings are rejected instead of silently normalized", () => {
  const workspace = tempWorkspace();
  const file = planFixture(workspace);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("executionMode: strict", "executionMode: turbo"));
  const validation = validatePlan(file);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(" "), /invalid executionMode/);
  assert.throws(() => approvePlan(file), /plan_invalid/);
});

test("v1 migration writes a separate reviewable draft and preserves the source", () => {
  const workspace = tempWorkspace();
  const source = path.join(workspace, ".orchestrator/plans/legacy.md");
  const original = `---\nworkspace: ${workspace}\ntask: legacy\n---\n\n# Legacy\n\n## Todo\n\n- [ ] Add CLI\n- [ ] Add tests\n`;
  fs.writeFileSync(source, original);
  const migrated = migratePlanV1({ planPath: source });
  assert.equal(fs.readFileSync(source, "utf8"), original);
  assert.notEqual(migrated.output, source);
  assert.equal(migrated.validation.ok, true);
  const plan = parsePlan(migrated.output);
  assert.equal(plan.metadata.status, "draft");
  assert.deepEqual(plan.phases.map((phase) => phase.id), ["P01", "P02"]);
  assert.ok(plan.hardRules.length >= 3);
});
