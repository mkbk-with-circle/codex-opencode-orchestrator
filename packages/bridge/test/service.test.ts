import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { approvePlan, parsePlan } from "../src/v2/plan.js";
import { readEvents, readRun } from "../src/v2/state.js";
import {
  completeRunV2,
  acknowledgeSupervisorEventV2,
  dispatchWindowV2,
  pendingSupervisorEventsV2,
  phaseReportV2,
  phaseStartV2,
  provideHumanReplyV2,
  replaceRunSessionV2,
  reviewPhaseV2,
  retryPhaseV2,
  startRunV2,
  statusV2,
} from "../src/v2/service.js";
import { planFixture, tempWorkspace } from "./helpers.js";

function withBoundWorkspace<T>(workspace: string, fn: () => T): T {
  const previousA = process.env.ORCHESTRATOR_TARGET_WORKSPACE;
  const previousB = process.env.TARGET_WORKSPACE;
  process.env.ORCHESTRATOR_TARGET_WORKSPACE = workspace;
  process.env.TARGET_WORKSPACE = workspace;
  try {
    return fn();
  } finally {
    if (previousA === undefined) delete process.env.ORCHESTRATOR_TARGET_WORKSPACE;
    else process.env.ORCHESTRATOR_TARGET_WORKSPACE = previousA;
    if (previousB === undefined) delete process.env.TARGET_WORKSPACE;
    else process.env.TARGET_WORKSPACE = previousB;
  }
}

async function withBoundWorkspaceAsync<T>(workspace: string, fn: () => Promise<T>): Promise<T> {
  const previousA = process.env.ORCHESTRATOR_TARGET_WORKSPACE;
  const previousB = process.env.TARGET_WORKSPACE;
  process.env.ORCHESTRATOR_TARGET_WORKSPACE = workspace;
  process.env.TARGET_WORKSPACE = workspace;
  try {
    return await fn();
  } finally {
    if (previousA === undefined) delete process.env.ORCHESTRATOR_TARGET_WORKSPACE;
    else process.env.ORCHESTRATOR_TARGET_WORKSPACE = previousA;
    if (previousB === undefined) delete process.env.TARGET_WORKSPACE;
    else process.env.TARGET_WORKSPACE = previousB;
  }
}

test("strict service lifecycle requires per-phase Codex acceptance", () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as {
      run: { id: string; authorizedPhaseIds: string[] };
    };
    const runId = started.run.id;
    assert.deepEqual(started.run.authorizedPhaseIds, ["P01"]);

    phaseStartV2({ runId, phaseId: "P01" });
    phaseReportV2({
      runId,
      phaseId: "P01",
      outcome: "complete",
      comment: "first done",
      evidence: ["test one passed"],
    });
    assert.throws(() => completeRunV2({ runId }), /not_all_phases_accepted/);
    reviewPhaseV2({
      runId,
      verdict: { verdict: "accept", phaseId: "P01", summary: "verified" },
    });
    let current = statusV2({ runId }) as { run: { authorizedPhaseIds: string[] } };
    assert.deepEqual(current.run.authorizedPhaseIds, ["P02"]);

    phaseStartV2({ runId, phaseId: "P02" });
    phaseReportV2({ runId, phaseId: "P02", outcome: "complete", comment: "second done" });
    reviewPhaseV2({
      runId,
      verdict: { verdict: "accept", phaseId: "P02", summary: "verified" },
    });
    const completed = completeRunV2({ runId, note: "all verified" }) as {
      run: { status: string };
    };
    assert.equal(completed.run.status, "completed");
  });
});

test("starting an already running phase is idempotent", () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    const first = phaseStartV2({ runId: started.run.id, phaseId: "P01" }) as {
      result: { attempt: number; idempotent?: boolean };
    };
    const second = phaseStartV2({ runId: started.run.id, phaseId: "P01" }) as typeof first;
    assert.equal(first.result.attempt, 1);
    assert.equal(second.result.attempt, 1);
    assert.equal(second.result.idempotent, true);
    assert.equal(
      readEvents(workspace, started.run.id).filter((event) => event.type === "phase.started").length,
      1,
    );
  });
});

test("phase reporting cannot bypass the bound workspace", () => {
  const workspace = tempWorkspace();
  const other = tempWorkspace();
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    assert.throws(
      () => phaseStartV2({ runId: started.run.id, phaseId: "P01", workspace: other }),
      /workspace_not_bound/,
    );
  });
});

test("a stalled executor session can be replaced unless a human hold is open", async () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  await withBoundWorkspaceAsync(workspace, async () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    const runId = started.run.id;
    await dispatchWindowV2({ runId });
    const replaced = await replaceRunSessionV2({ runId, reason: "stalled" }) as {
      result: { previousSessionId?: string; sessionId?: string };
    };
    assert.ok(replaced.result.previousSessionId);
    assert.ok(replaced.result.sessionId);
    assert.equal(readEvents(workspace, runId).at(-1)?.type, "run.session_replaced");

    phaseStartV2({ runId, phaseId: "P01" });
    phaseReportV2({ runId, phaseId: "P01", outcome: "blocked", keepAlive: true, holdKind: "otp" });
    await assert.rejects(() => replaceRunSessionV2({ runId }), /open_human_hold/);
  });
});

test("phase snapshots preserve leading dots and exclude orchestrator metadata", () => {
  const workspace = tempWorkspace();
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, "README.md"), "baseline\n");
  execFileSync("git", ["add", "README.md"], { cwd: workspace });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "baseline"], { cwd: workspace });
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    fs.writeFileSync(planPath, `${fs.readFileSync(planPath, "utf8")}\n`);
    const result = phaseStartV2({ runId: started.run.id, phaseId: "P01" }) as {
      run: { phases: Record<string, { baselinePaths?: string[] }> };
    };
    assert.deepEqual(result.run.phases.P01.baselinePaths, []);
  });
});

test("retry resets the executor report while preserving Codex rework gaps", () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    const runId = started.run.id;
    phaseStartV2({ runId, phaseId: "P01" });
    phaseReportV2({ runId, phaseId: "P01", outcome: "complete", comment: "first try" });
    reviewPhaseV2({
      runId,
      verdict: { verdict: "rework", phaseId: "P01", summary: "not yet", gaps: ["add coverage"] },
    });
    const retried = retryPhaseV2({ runId, phaseId: "P01" }) as {
      run: { phases: Record<string, { executorReportStatus: string; gaps: string[] }> };
    };
    assert.equal(retried.run.phases.P01.executorReportStatus, "pending");
    assert.deepEqual(retried.run.phases.P01.gaps, ["add coverage"]);
    assert.equal(parsePlan(planPath).phases[0].report.status, "pending");
  });
});

test("unauthorized phase action pauses run and records protocol violation", () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    assert.throws(
      () => phaseStartV2({ runId: started.run.id, phaseId: "P02" }),
      /protocol_violation/,
    );
    const current = statusV2({ runId: started.run.id }) as {
      run: { status: string; error?: string };
      recentEvents: Array<{ type: string }>;
    };
    assert.equal(current.run.status, "paused");
    assert.match(current.run.error || "", /protocol_violation/);
    assert.equal(current.recentEvents.at(-1)?.type, "protocol.violation");
  });
});

test("blocked phase binds a human reply to the same run and phase", () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    const runId = started.run.id;
    phaseStartV2({ runId, phaseId: "P01" });
    phaseReportV2({
      runId,
      phaseId: "P01",
      outcome: "blocked",
      comment: "need a choice",
      needUser: "choose A or B",
      keepAlive: true,
    });
    let current = statusV2({ runId }) as { run: { status: string }; phases: Array<{ id: string; status: string }> };
    assert.equal(current.run.status, "paused");
    assert.equal(current.phases.find((item) => item.id === "P01")?.status, "blocked");
    provideHumanReplyV2({ runId, reply: "A" });
    current = statusV2({ runId }) as typeof current;
    assert.equal(current.run.status, "running");
    assert.equal(current.phases.find((item) => item.id === "P01")?.status, "running");
  });
});

test("supervisor cursor acknowledges actionable events durably", () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    const runId = started.run.id;
    phaseStartV2({ runId, phaseId: "P01" });
    phaseReportV2({ runId, phaseId: "P01", outcome: "complete", comment: "done" });
    const pending = pendingSupervisorEventsV2({ runId }) as {
      events: Array<{ seq: number; type: string }>;
    };
    const implemented = pending.events.find((event) => event.type === "phase.implemented");
    assert.ok(implemented);
    acknowledgeSupervisorEventV2({ runId, seq: implemented.seq });
    const after = pendingSupervisorEventsV2({ runId }) as { events: Array<{ seq: number }> };
    assert.equal(after.events.some((event) => event.seq <= implemented.seq), false);
  });
});

test("phase path scope compares against that phase start, not the whole run", () => {
  const workspace = tempWorkspace();
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, "README.md"), "baseline\n");
  execFileSync("git", ["add", "README.md"], { cwd: workspace });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "baseline"], { cwd: workspace });
  const planPath = planFixture(workspace);
  fs.writeFileSync(
    planPath,
    fs.readFileSync(planPath, "utf8")
      .replace("允许修改：src/**", "允许修改：src/one.txt")
      .replace("允许修改：src/**", "允许修改：src/two.txt"),
  );
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    const runId = started.run.id;
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    phaseStartV2({ runId, phaseId: "P01" });
    fs.writeFileSync(path.join(workspace, "src/one.txt"), "one\n");
    phaseReportV2({ runId, phaseId: "P01", outcome: "complete" });
    reviewPhaseV2({ runId, verdict: { verdict: "accept", phaseId: "P01", summary: "ok" } });

    phaseStartV2({ runId, phaseId: "P02" });
    fs.writeFileSync(path.join(workspace, "src/two.txt"), "two\n");
    assert.doesNotThrow(() => phaseReportV2({ runId, phaseId: "P02", outcome: "complete" }));
  });
});

test("phase scope detects edits inside a previously untracked directory", () => {
  const workspace = tempWorkspace();
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, "README.md"), "baseline\n");
  execFileSync("git", ["add", "README.md"], { cwd: workspace });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "baseline"], { cwd: workspace });
  const planPath = planFixture(workspace);
  fs.writeFileSync(
    planPath,
    fs.readFileSync(planPath, "utf8")
      .replace("允许修改：src/**", "允许修改：src/one.txt")
      .replace("允许修改：src/**", "允许修改：src/two.txt"),
  );
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    const runId = started.run.id;
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    phaseStartV2({ runId, phaseId: "P01" });
    fs.writeFileSync(path.join(workspace, "src/one.txt"), "one\n");
    phaseReportV2({ runId, phaseId: "P01", outcome: "complete" });
    reviewPhaseV2({ runId, verdict: { verdict: "accept", phaseId: "P01", summary: "ok" } });

    phaseStartV2({ runId, phaseId: "P02" });
    fs.writeFileSync(path.join(workspace, "src/one.txt"), "tampered\n");
    fs.writeFileSync(path.join(workspace, "src/two.txt"), "two\n");
    assert.throws(
      () => phaseReportV2({ runId, phaseId: "P02", outcome: "complete" }),
      /paths_outside_scope:src\/one\.txt/,
    );
  });
});

test("direct edits to a dynamic Plan report pause the run as a protocol violation", () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  withBoundWorkspace(workspace, () => {
    const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
    const runId = started.run.id;
    fs.writeFileSync(planPath, fs.readFileSync(planPath, "utf8").replace("comment:\n", "comment: edited directly\n"));
    assert.throws(() => statusV2({ runId }), /protocol_violation: P01:report_comment/);
    assert.equal(readRun(workspace, runId).status, "paused");
    assert.equal(readEvents(workspace, runId).at(-1)?.type, "protocol.violation");
  });
});
