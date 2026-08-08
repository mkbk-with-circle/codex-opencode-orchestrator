import assert from "node:assert/strict";
import test from "node:test";
import { approvePlan, parsePlan } from "../src/v2/plan.js";
import { allPhasesAccepted, computeAuthorizedWindow } from "../src/v2/scheduler.js";
import { createRun, mutateRun, readEvents, readRun, transitionPhase } from "../src/v2/state.js";
import type { RunStateV2 } from "../src/v2/types.js";
import { planFixture, tempWorkspace } from "./helpers.js";

function fixtureRun(workspace: string, planPath: string, mode: "strict" | "batch" = "strict"): RunStateV2 {
  const plan = approvePlan(planPath);
  return {
    schemaVersion: 2,
    id: `run-${Date.now()}-${Math.random()}`,
    planId: plan.metadata.planId,
    planPath,
    planSpecHash: plan.computedSpecHash,
    workspace,
    status: "running",
    executionMode: mode,
    batchSize: mode === "strict" ? 1 : 2,
    executorId: "mock",
    executorType: "mock",
    baselineDirtyPaths: [],
    baselineDirtyHashes: {},
    authorizedPhaseIds: [],
    phases: {
      P01: { id: "P01", status: "pending", attempt: 0, evidence: [], gaps: [] },
      P02: { id: "P02", status: "pending", attempt: 0, evidence: [], gaps: [] },
    },
    nextSeq: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("state transitions and event journal survive reload", () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  const run = fixtureRun(workspace, planPath);
  createRun(run);
  mutateRun(workspace, run.id, (current) => {
    transitionPhase(current, "P01", "ready");
    return { result: null, events: [{ type: "phase.ready", phaseId: "P01" }] };
  });
  assert.equal(readRun(workspace, run.id).phases.P01.status, "ready");
  assert.deepEqual(readEvents(workspace, run.id).map((event) => event.seq), [1, 2]);
  assert.throws(() => {
    mutateRun(workspace, run.id, (current) => {
      transitionPhase(current, "P02", "accepted");
      return { result: null };
    });
  }, /invalid_phase_transition/);
});

test("strict and batch windows respect order and accepted dependencies", () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  const strictRun = fixtureRun(workspace, planPath, "strict");
  const plan = parsePlan(planPath);
  assert.deepEqual(computeAuthorizedWindow(plan, strictRun), ["P01"]);

  strictRun.executionMode = "batch";
  strictRun.batchSize = 2;
  assert.deepEqual(computeAuthorizedWindow(plan, strictRun), ["P01", "P02"]);
  strictRun.phases.P01.status = "accepted";
  assert.deepEqual(computeAuthorizedWindow(plan, strictRun), ["P02"]);
  strictRun.phases.P02.status = "accepted";
  assert.equal(allPhasesAccepted(strictRun), true);
});
