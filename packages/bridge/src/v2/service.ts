import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { loadOrchestratorConfig, repoRoot } from "../config.js";
import { OpenCodeHttpExecutor } from "../adapters/opencode-http.js";
import { MockExecutor } from "../adapters/mock.js";
import type { ExecutorAdapter, RunState as LegacyRunState } from "../types.js";
import { resolveExecutor, resolveProfileToExecutor } from "../profiles.js";
import {
  beginUserHold,
  orchestratorPaths,
  provideUserReply,
} from "../user-hold.js";
import {
  assertInsideBound,
  requireBoundWorkspace,
  resolveBoundPlanPath,
} from "../workspace.js";
import {
  approvePlan,
  assertPlanIntegrity,
  parsePlan,
  migratePlanV1,
  updateCodexReview,
  updateExecutorReport,
  updatePlanLifecycle,
  validatePlan,
} from "./plan.js";
import {
  createRun,
  type EventDraft,
  listRuns,
  mutateRun,
  newestRun,
  readEvents,
  readReviewCursor,
  readRun,
  runDirectory,
  transitionPhase,
  writeReviewCursor,
} from "./state.js";
import { atomicWrite, atomicWriteJson } from "./fs.js";
import { allPhasesAccepted, computeAuthorizedWindow } from "./scheduler.js";
import type {
  ExecutionMode,
  PhaseRuntime,
  ReviewVerdict,
  RunStateV2,
} from "./types.js";

function getAdapter(type: string): ExecutorAdapter {
  if (type === "mock") return new MockExecutor();
  if (type === "opencode-http") return new OpenCodeHttpExecutor();
  throw new Error(`unknown_executor_type: ${type}`);
}

function resolvePlan(planPath?: string): string {
  const bound = requireBoundWorkspace();
  return resolveBoundPlanPath(bound, planPath);
}

function resolveRun(runId?: string, workspace?: string): RunStateV2 {
  const root = workspace ? path.resolve(workspace) : requireBoundWorkspace().absPath;
  if (workspace && !path.isAbsolute(workspace)) throw new Error("workspace_must_be_absolute");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`workspace_not_found: ${root}`);
  }
  const run = runId ? readRun(root, runId) : newestRun(root);
  if (!run) throw new Error("no_v2_runs");
  if (path.resolve(run.workspace) !== root) throw new Error("run_workspace_mismatch");
  return run;
}

function gitOutput(workspace: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return "";
  }
}

function fileHash(workspace: string, relative: string): string | null {
  const file = path.join(workspace, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function indexFileHash(workspace: string, relative: string): string | null {
  try {
    const content = execFileSync("git", ["show", `:${relative}`], {
      cwd: workspace,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

function baseline(workspace: string): { commit?: string; dirty: string[]; hashes: Record<string, string | null> } {
  const commit = gitOutput(workspace, ["rev-parse", "HEAD"]) || undefined;
  const dirty = gitOutput(workspace, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter((file) => !file.startsWith(".orchestrator/"));
  return {
    commit,
    dirty,
    hashes: Object.fromEntries(dirty.map((file) => [file, fileHash(workspace, file)])),
  };
}

function legacyRun(run: RunStateV2): LegacyRunState {
  return {
    id: run.id,
    status: run.status === "completed" ? "completed" : "running",
    executorId: run.executorId,
    executorType: run.executorType,
    model: run.model,
    planPath: run.planPath,
    briefPath: "",
    workspace: run.workspace,
    sessionId: run.sessionId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    promptSentAt: run.lastHeartbeatAt || run.updatedAt,
    seenBusy: Boolean(run.lastHeartbeatAt),
  };
}

function cleanProjectionText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function planProjectionMismatch(run: RunStateV2): string | null {
  const plan = assertPlanIntegrity(run.planPath);
  for (const definition of plan.phases) {
    const runtime = run.phases[definition.id];
    if (!runtime) return `${definition.id}:runtime_missing`;
    const expectedChecked = ["implemented", "reviewing", "accepted"].includes(runtime.status);
    if (definition.checked !== expectedChecked) return `${definition.id}:checkbox`;
    const expectedStatus = runtime.executorReportStatus || "pending";
    if (definition.report.status !== expectedStatus) return `${definition.id}:report_status`;
    if (cleanProjectionText(definition.report.comment) !== cleanProjectionText(runtime.comment || "")) {
      return `${definition.id}:report_comment`;
    }
    const expectedEvidence = runtime.evidence.map(cleanProjectionText);
    if (JSON.stringify(definition.report.evidence) !== JSON.stringify(expectedEvidence)) {
      return `${definition.id}:report_evidence`;
    }
  }
  return null;
}

function guardRunPlan(run: RunStateV2): void {
  let reason: string | null = null;
  try {
    reason = planProjectionMismatch(run);
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  if (!reason) return;
  if (!(run.status === "paused" && run.error === `protocol_violation: ${reason}`)) {
    mutateRun(run.workspace, run.id, (current) => protocolViolation(current, "PLAN", reason as string));
  }
  throw new Error(`protocol_violation: ${reason}`);
}

function phaseBrief(run: RunStateV2): string {
  const plan = assertPlanIntegrity(run.planPath);
  const allowed = new Set(run.authorizedPhaseIds);
  const phases = plan.phases.filter((phase) => allowed.has(phase.id));
  const orchCli = path.join(repoRoot(), "bin", "orch");
  if (!phases.length) throw new Error("no_authorized_phases");
  return [
    "# Codex-orchestrated execution window",
    "",
    `Run: ${run.id}`,
    `Workspace: ${run.workspace}`,
    `Mode: ${run.executionMode}; authorized phases: ${phases.map((p) => p.id).join(", ")}`,
    "",
    "## Hard rules",
    ...plan.hardRules.map((rule) => `- ${rule}`),
    "",
    "## Authorized phases only",
    ...phases.flatMap((phase) => [
      `### ${phase.id} — ${phase.title}`,
      `Dependencies: ${phase.dependencies.join(", ") || "none"}`,
      `Allowed paths: ${phase.allowedPaths.join(", ")}`,
      `Acceptance: ${phase.acceptance.join("; ") || "follow the Plan exactly"}`,
      "",
    ]),
    "## Mandatory reporting protocol",
    "Do not edit the Plan directly. Report only through the orchestrator_reporter MCP server.",
    `Before edits call orchestrator_reporter.phase_start with workspace=${JSON.stringify(run.workspace)}, runId=${run.id}, phaseId=<PHASE_ID>.`,
    `After work call orchestrator_reporter.phase_report with workspace=${JSON.stringify(run.workspace)}, runId=${run.id}, phaseId=<PHASE_ID>, outcome=complete|failed|blocked, comment, and evidence.`,
    "For credentials/OTP/2FA or another human-only input: report blocked with keepAlive=true and the matching holdKind, then immediately call orchestrator_reporter.wait_for_human_reply while keeping the browser/CLI/process open. Continue the same attempt after it returns; never print or persist the reply.",
    `If the reporter MCP is unavailable only, use: ORCHESTRATOR_TARGET_WORKSPACE=${JSON.stringify(run.workspace)} bash ${JSON.stringify(orchCli)} phase ...`,
    "In batch mode work in listed order. Stop immediately on blocked or failed.",
    "Never work on a phase not listed above. Never mark the overall run complete. Never push.",
  ].join("\n");
}

function markReady(run: RunStateV2, phaseIds: string[]) {
  const events: Array<{
    type: "phase.ready";
    phaseId: string;
    attempt: number;
  }> = [];
  for (const id of phaseIds) {
    const phase = run.phases[id];
    if (phase.status === "pending" || phase.status === "review_failed" || phase.status === "attempt_failed" || phase.status === "blocked") {
      transitionPhase(run, id, "ready");
      events.push({ type: "phase.ready", phaseId: id, attempt: phase.attempt });
    }
  }
  run.authorizedPhaseIds = phaseIds;
  return events;
}

export function validatePlanV2Tool(args: { planPath?: string }) {
  const planPath = resolvePlan(args.planPath);
  return { ...validatePlan(planPath), planPath };
}

export function approvePlanV2Tool(args: { planPath?: string }) {
  const planPath = resolvePlan(args.planPath);
  const plan = approvePlan(planPath);
  return {
    ok: true,
    planPath,
    planId: plan.metadata.planId,
    specHash: plan.metadata.specHash,
    phases: plan.phases.map(({ id, title }) => ({ id, title })),
  };
}

export function migratePlanV2Tool(args: { planPath?: string; outputPath?: string; inPlace?: boolean }) {
  const planPath = resolvePlan(args.planPath);
  const bound = requireBoundWorkspace();
  const outputPath = args.outputPath ? path.resolve(bound.absPath, args.outputPath) : undefined;
  if (outputPath) assertInsideBound(outputPath, bound, "migration output");
  return migratePlanV1({ planPath, outputPath, inPlace: args.inPlace });
}

export function startRunV2(args: {
  planPath?: string;
  executorId?: string;
  mode?: ExecutionMode;
  batchSize?: number;
}): Record<string, unknown> {
  const bound = requireBoundWorkspace();
  const gitRoot = gitOutput(bound.absPath, ["rev-parse", "--show-toplevel"]);
  const realGitRoot = gitRoot ? fs.realpathSync(gitRoot) : "";
  const realWorkspace = fs.realpathSync(bound.absPath);
  if (!gitRoot || realGitRoot !== realWorkspace) {
    throw new Error(`workspace_must_be_git_root: ${bound.absPath}; run git init before starting a v2 Run`);
  }
  const planPath = resolvePlan(args.planPath);
  const plan = assertPlanIntegrity(planPath);
  if (path.resolve(plan.metadata.workspace) !== bound.absPath) {
    throw new Error(`plan_workspace_mismatch: ${plan.metadata.workspace}`);
  }
  const orch = loadOrchestratorConfig(repoRoot());
  const resolved = resolveExecutor(args.executorId, orch.default_executor, repoRoot());
  const mode = args.mode || plan.metadata.executionMode;
  const batchSize = mode === "strict" ? 1 : Math.max(1, Math.floor(args.batchSize || plan.metadata.batchSize));
  const now = new Date().toISOString();
  const base = baseline(bound.absPath);
  const phases = Object.fromEntries(
    plan.phases.map((phase) => [
      phase.id,
      {
        id: phase.id,
        status: "pending",
        attempt: 0,
        evidence: [],
        gaps: [],
        executorReportStatus: phase.report.status,
      } satisfies PhaseRuntime,
    ]),
  );
  const run: RunStateV2 = {
    schemaVersion: 2,
    id: `${now.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    planId: plan.metadata.planId,
    planPath,
    planSpecHash: plan.computedSpecHash,
    workspace: bound.absPath,
    status: "running",
    executionMode: mode,
    batchSize,
    executorId: resolved.id,
    executorType: resolved.def.type,
    model: typeof resolved.def.options.model === "string" ? resolved.def.options.model : undefined,
    baselineCommit: base.commit,
    baselineDirtyPaths: base.dirty,
    baselineDirtyHashes: base.hashes,
    authorizedPhaseIds: [],
    phases,
    nextSeq: 1,
    createdAt: now,
    updatedAt: now,
  };
  createRun(run);
  updatePlanLifecycle(planPath, "running");
  const initialized = mutateRun(bound.absPath, run.id, (current) => {
    const window = computeAuthorizedWindow(plan, current);
    return { result: window, events: markReady(current, window) };
  });
  return {
    ok: true,
    run: initialized.run,
    authorizedPhaseIds: initialized.result,
    events: initialized.events,
  };
}

export async function dispatchWindowV2(args: { runId?: string }): Promise<Record<string, unknown>> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  if (run.status !== "running") throw new Error(`run_not_running: ${run.status}`);
  if (!run.authorizedPhaseIds.length) throw new Error("no_authorized_phases");
  const orch = loadOrchestratorConfig(repoRoot());
  const resolved = resolveExecutor(run.executorId, orch.default_executor, repoRoot());
  const adapter = getAdapter(resolved.def.type);
  const brief = phaseBrief(run);
  if (!run.sessionId) {
    const started = await adapter.start({
      run: legacyRun(run),
      brief,
      workspace: run.workspace,
      options: resolved.def.options,
    });
    const out = mutateRun(run.workspace, run.id, (current) => {
      current.sessionId = started.sessionId;
      current.summary = started.summary;
      current.lastHeartbeatAt = new Date().toISOString();
      return { result: started };
    });
    return { ok: true, run: out.run, started };
  }
  const progress = await adapter.progress({
    run: legacyRun(run),
    options: resolved.def.options,
    prompt: brief,
    model: run.model,
  });
  const out = mutateRun(run.workspace, run.id, (current) => {
    current.summary = progress.progress;
    current.lastHeartbeatAt = new Date().toISOString();
    return { result: progress };
  });
  return { ok: true, run: out.run, resumed: true, progress };
}

export function switchRunModelV2(args: { runId?: string; executorId: string }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  const resolved = resolveProfileToExecutor(args.executorId, repoRoot());
  if (resolved.def.type !== "opencode-http") throw new Error("run_model_requires_opencode_profile");
  const model = String(resolved.def.options.model || "");
  if (!model) throw new Error("profile_model_missing");
  const out = mutateRun(run.workspace, run.id, (current) => {
    if (["completed", "cancelled", "failed"].includes(current.status)) {
      throw new Error(`run_terminal: ${current.status}`);
    }
    const previous = current.model || null;
    current.executorId = resolved.id;
    current.executorType = resolved.def.type;
    current.model = model;
    current.summary = `Run model changed to ${model}; OpenCode session preserved`;
    return {
      result: { previous, model, sessionId: current.sessionId || null },
      events: [{ type: "run.model_changed" as const, payload: { previous, model, executorId: resolved.id } }],
    };
  });
  return { ok: true, ...out };
}

export async function replaceRunSessionV2(args: { runId?: string; reason?: string }): Promise<Record<string, unknown>> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  if (["completed", "cancelled", "failed"].includes(run.status)) {
    throw new Error(`run_terminal: ${run.status}`);
  }
  const holdPath = orchestratorPaths(run.workspace).hold;
  if (fs.existsSync(holdPath)) {
    const hold = JSON.parse(fs.readFileSync(holdPath, "utf8")) as { status?: string; keepAlive?: boolean };
    if (hold.status === "open") throw new Error("cannot_replace_session_with_open_human_hold");
  }
  const orch = loadOrchestratorConfig(repoRoot());
  const resolved = resolveExecutor(run.executorId, orch.default_executor, repoRoot());
  const adapter = getAdapter(resolved.def.type);
  const previousSessionId = run.sessionId;
  const aborted = previousSessionId
    ? await adapter.abort({ run: legacyRun(run), options: resolved.def.options })
    : undefined;
  const freshRun = { ...run, sessionId: undefined };
  const started = await adapter.start({
    run: legacyRun(freshRun),
    brief: phaseBrief(run),
    workspace: run.workspace,
    options: resolved.def.options,
  });
  const out = mutateRun(run.workspace, run.id, (current) => {
    current.sessionId = started.sessionId;
    current.summary = started.summary;
    current.lastHeartbeatAt = new Date().toISOString();
    delete current.error;
    return {
      result: { previousSessionId, sessionId: started.sessionId, aborted },
      events: [{
        type: "run.session_replaced" as const,
        payload: { previousSessionId, sessionId: started.sessionId, reason: args.reason || "manual recovery" },
      }],
    };
  });
  return { ok: true, ...out };
}

export function phaseStartV2(args: { runId?: string; phaseId: string; workspace?: string }): Record<string, unknown> {
  const run = resolveRun(args.runId, args.workspace);
  guardRunPlan(run);
  const snapshot = phaseSnapshot(run.workspace);
  const out = mutateRun<
    { violation: string } | { phaseId: string; attempt: number; idempotent?: boolean }
  >(run.workspace, run.id, (current) => {
    if (!current.authorizedPhaseIds.includes(args.phaseId)) {
      return protocolViolation(current, args.phaseId, "phase_not_authorized");
    }
    const phase = current.phases[args.phaseId];
    if (phase.status === "running") {
      return {
        result: { phaseId: args.phaseId, attempt: phase.attempt, idempotent: true },
      };
    }
    transitionPhase(current, args.phaseId, "running");
    phase.attempt += 1;
    phase.startedAt = new Date().toISOString();
    phase.baselinePaths = snapshot.paths;
    phase.baselineHashes = snapshot.hashes;
    phase.executorReportStatus = "running";
    phase.comment = `attempt ${phase.attempt} started`;
    phase.evidence = [];
    updateExecutorReport(current.planPath, args.phaseId, {
      status: "running",
      comment: phase.comment,
      evidence: [],
    }, false);
    return {
      result: { phaseId: args.phaseId, attempt: phase.attempt },
      events: [{ type: "phase.started" as const, phaseId: args.phaseId, attempt: phase.attempt }],
    };
  });
  if ((out.result as { violation?: string }).violation) {
    throw new Error(`protocol_violation: ${args.phaseId}: ${(out.result as { violation: string }).violation}`);
  }
  return { ok: true, ...out };
}

function protocolViolation(run: RunStateV2, phaseId: string, reason: string) {
  run.status = "paused";
  run.error = `protocol_violation: ${reason}`;
  run.authorizedPhaseIds = [];
  return {
    result: { violation: reason },
    events: [{
      type: "protocol.violation" as const,
      phaseId,
      payload: { reason },
    }],
  };
}

function changedPaths(workspace: string): string[] {
  return gitOutput(workspace, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter((file) => !file.startsWith(".orchestrator/"));
}

function phaseSnapshot(workspace: string): { paths: string[]; hashes: Record<string, string | null> } {
  const paths = changedPaths(workspace);
  return {
    paths,
    hashes: Object.fromEntries(paths.map((file) => [file, fileHash(workspace, file)])),
  };
}

function pathsChangedSincePhaseStart(run: RunStateV2, phaseId: string): string[] {
  const runtime = run.phases[phaseId];
  if (!runtime) return [];
  // Early v2 builds used String.trim() on porcelain output, which could turn
  // `.orchestrator/...` into `orchestrator/...`. Ignore that migrated runtime
  // metadata just as we ignore the correctly parsed path.
  const beforePaths = (runtime.baselinePaths || run.baselineDirtyPaths)
    .filter((file) => file !== "orchestrator" && !file.startsWith("orchestrator/"));
  const beforeHashes = runtime.baselineHashes || run.baselineDirtyHashes;
  const candidates = new Set([...beforePaths, ...changedPaths(run.workspace)]);
  return [...candidates]
    .filter((file) => {
      const before = Object.prototype.hasOwnProperty.call(beforeHashes, file)
        ? beforeHashes[file]
        : indexFileHash(run.workspace, file);
      return fileHash(run.workspace, file) !== before;
    })
    .sort();
}

function pathMatches(pattern: string, file: string): boolean {
  const normalized = pattern.replace(/^\.\//, "");
  if (normalized === "**/*" || normalized === "*") return true;
  if (normalized.endsWith("/**")) return file === normalized.slice(0, -3) || file.startsWith(normalized.slice(0, -2));
  if (!normalized.includes("*")) return file === normalized;
  const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(file);
}

function unauthorizedChangedPaths(run: RunStateV2, phaseId: string): string[] {
  const plan = assertPlanIntegrity(run.planPath);
  const phase = plan.phases.find((item) => item.id === phaseId);
  if (!phase) return [];
  return pathsChangedSincePhaseStart(run, phaseId).filter(
    (file) => !phase.allowedPaths.some((pattern) => pathMatches(pattern, file)),
  );
}

export function phaseReportV2(args: {
  runId?: string;
  workspace?: string;
  phaseId: string;
  outcome: "complete" | "failed" | "blocked";
  comment?: string;
  evidence?: string[];
  needUser?: string;
  keepAlive?: boolean;
  holdKind?: string;
}): Record<string, unknown> {
  const run = resolveRun(args.runId, args.workspace);
  guardRunPlan(run);
  const outside = unauthorizedChangedPaths(run, args.phaseId);
  const runtime = run.phases[args.phaseId];
  const artifactDir = path.join(runDirectory(run.workspace, run.id), "artifacts");
  const artifactBase = `${args.phaseId}-attempt-${runtime?.attempt || 0}`;
  fs.mkdirSync(artifactDir, { recursive: true });
  atomicWrite(path.join(artifactDir, `${artifactBase}.diff`), `${gitOutput(run.workspace, ["diff", "--", "."])}\n`);
  atomicWriteJson(path.join(artifactDir, `${artifactBase}.json`), {
    phaseId: args.phaseId,
    attempt: runtime?.attempt || 0,
    outcome: args.outcome,
    comment: args.comment || "",
    evidence: args.evidence || [],
    changedPaths: pathsChangedSincePhaseStart(run, args.phaseId),
    workspaceDirtyPaths: changedPaths(run.workspace),
    capturedAt: new Date().toISOString(),
  });
  const out = mutateRun<{ violation: string } | { phaseId: string; status: string }>(run.workspace, run.id, (current) => {
    if (!current.authorizedPhaseIds.includes(args.phaseId)) {
      return protocolViolation(current, args.phaseId, "phase_not_authorized");
    }
    const phase = current.phases[args.phaseId];
    if (phase.status !== "running") {
      return protocolViolation(current, args.phaseId, `phase_not_running:${phase.status}`);
    }
    if (outside.length) {
      return protocolViolation(current, args.phaseId, `paths_outside_scope:${outside.join(",")}`);
    }
    phase.comment = args.comment?.trim() || "";
    phase.evidence = (args.evidence || []).map((item) => item.trim()).filter(Boolean);
    let eventType: "phase.implemented" | "phase.attempt_failed" | "phase.blocked";
    if (args.outcome === "complete") {
      transitionPhase(current, args.phaseId, "implemented");
      phase.implementedAt = new Date().toISOString();
      eventType = "phase.implemented";
      current.authorizedPhaseIds = current.authorizedPhaseIds.filter((id) => id !== args.phaseId);
    } else if (args.outcome === "failed") {
      transitionPhase(current, args.phaseId, "attempt_failed");
      eventType = "phase.attempt_failed";
      current.authorizedPhaseIds = [];
    } else {
      transitionPhase(current, args.phaseId, "blocked");
      eventType = "phase.blocked";
      current.authorizedPhaseIds = [];
      current.status = "paused";
      beginUserHold(current.workspace, {
        kind: args.holdKind || "other",
        keepAlive: args.keepAlive,
        question: args.needUser || args.comment || "Phase requires human input",
        needWhat: args.needUser,
        runId: current.id,
        phaseId: args.phaseId,
        attempt: phase.attempt,
      });
    }
    phase.executorReportStatus = phase.status;
    updateExecutorReport(current.planPath, args.phaseId, {
      status: phase.status,
      comment: phase.comment,
      evidence: phase.evidence,
    }, args.outcome === "complete");
    return {
      result: { phaseId: args.phaseId, status: phase.status },
      events: [{
        type: eventType,
        phaseId: args.phaseId,
        attempt: phase.attempt,
        payload: { comment: phase.comment, evidence: phase.evidence },
      }],
    };
  });
  if ((out.result as { violation?: string }).violation) {
    throw new Error(`protocol_violation: ${args.phaseId}: ${(out.result as { violation: string }).violation}`);
  }
  return { ok: true, ...out };
}

export function reviewPhaseV2(args: {
  runId?: string;
  verdict: ReviewVerdict;
}): Record<string, unknown> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  const out = mutateRun(run.workspace, run.id, (current) => {
    const phase = current.phases[args.verdict.phaseId];
    if (!phase) throw new Error(`phase_not_found: ${args.verdict.phaseId}`);
    if (phase.status !== "implemented") {
      throw new Error(`phase_not_implemented: ${args.verdict.phaseId}:${phase.status}`);
    }
    transitionPhase(current, phase.id, "reviewing");
    phase.reviewedAt = new Date().toISOString();
    phase.reviewSummary = args.verdict.summary;
    phase.gaps = args.verdict.gaps || [];
    const events: EventDraft[] = [{
      type: "review.started",
      phaseId: phase.id,
      attempt: phase.attempt,
    }];
    if (args.verdict.verdict === "accept") {
      transitionPhase(current, phase.id, "accepted");
      phase.acceptedAt = new Date().toISOString();
      events.push({ type: "review.accepted", phaseId: phase.id, attempt: phase.attempt });
      updateCodexReview(current.planPath, args.verdict);
      const plan = assertPlanIntegrity(current.planPath);
      if (allPhasesAccepted(current)) {
        current.status = "awaiting_final_review";
        current.authorizedPhaseIds = [];
      } else {
        const batchStillActive =
          current.authorizedPhaseIds.length > 0 ||
          Object.values(current.phases).some((item) =>
            item.id !== phase.id && ["implemented", "reviewing"].includes(item.status),
          );
        if (!batchStillActive) {
          const window = computeAuthorizedWindow(plan, current);
          events.push(...markReady(current, window));
        }
      }
    } else if (args.verdict.verdict === "rework") {
      transitionPhase(current, phase.id, "review_failed");
      current.authorizedPhaseIds = [];
      updateCodexReview(current.planPath, args.verdict);
      events.push({ type: "review.rework", phaseId: phase.id, attempt: phase.attempt });
    } else {
      transitionPhase(current, phase.id, "blocked");
      current.status = "paused";
      current.authorizedPhaseIds = [];
      updateCodexReview(current.planPath, args.verdict);
      beginUserHold(current.workspace, {
        kind: "decision",
        keepAlive: true,
        question: args.verdict.nextInstruction || args.verdict.summary,
        needWhat: args.verdict.gaps?.join("\n"),
        runId: current.id,
        phaseId: phase.id,
        attempt: phase.attempt,
      });
      events.push({ type: "review.needs_user", phaseId: phase.id, attempt: phase.attempt });
    }
    return { result: { phaseId: phase.id, status: phase.status }, events };
  });
  return { ok: true, ...out };
}

export function retryPhaseV2(args: { runId?: string; phaseId: string }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  const out = mutateRun(run.workspace, run.id, (current) => {
    const phase = current.phases[args.phaseId];
    if (!phase || !["blocked", "attempt_failed", "review_failed"].includes(phase.status)) {
      throw new Error(`phase_not_retryable: ${args.phaseId}:${phase?.status || "missing"}`);
    }
    if (orchestratorPaths(current.workspace).hold && fs.existsSync(orchestratorPaths(current.workspace).hold)) {
      const hold = JSON.parse(fs.readFileSync(orchestratorPaths(current.workspace).hold, "utf8")) as { status?: string };
      if (hold.status === "open") throw new Error("human_hold_open");
    }
    transitionPhase(current, args.phaseId, "ready");
    current.status = "running";
    delete current.error;
    current.authorizedPhaseIds = [args.phaseId];
    phase.executorReportStatus = "pending";
    phase.comment = "rework authorized; follow the latest Codex review gaps";
    phase.evidence = [];
    updateExecutorReport(current.planPath, phase.id, {
      status: "pending",
      comment: phase.comment,
      evidence: [],
    }, false);
    return {
      result: { phaseId: args.phaseId, status: "ready" },
      events: [{ type: "phase.ready" as const, phaseId: args.phaseId, attempt: phase.attempt }],
    };
  });
  return { ok: true, ...out };
}

export async function pollExecutorV2(args: { runId?: string }): Promise<Record<string, unknown>> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  if (!run.sessionId) return { ok: true, run, activity: "not_started" };
  const orch = loadOrchestratorConfig(repoRoot());
  const resolved = resolveExecutor(run.executorId, orch.default_executor, repoRoot());
  const poll = await getAdapter(resolved.def.type).poll({
    run: legacyRun(run),
    options: resolved.def.options,
  });
  const out = mutateRun(run.workspace, run.id, (current) => {
    current.lastHeartbeatAt = new Date().toISOString();
    current.summary = poll.summary || poll.progress;
    if (poll.activity === "failed" || poll.activity === "stalled") {
      current.error = poll.summary;
    }
    return { result: poll };
  });
  return { ok: true, run: out.run, poll };
}

export function reviewContextV2(args: { runId?: string; phaseId?: string }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  const plan = assertPlanIntegrity(run.planPath);
  const phaseId = args.phaseId || plan.phases.find((item) => run.phases[item.id]?.status === "implemented")?.id;
  if (!phaseId) throw new Error("no_phase_awaiting_review");
  const phase = plan.phases.find((item) => item.id === phaseId);
  if (!phase) throw new Error(`phase_not_found: ${phaseId}`);
  const diff = gitOutput(run.workspace, ["diff", "--", "."]);
  const paths = pathsChangedSincePhaseStart(run, phaseId);
  const attempt = run.phases[phaseId].attempt;
  const artifactBase = path.join(runDirectory(run.workspace, run.id), "artifacts", `${phaseId}-attempt-${attempt}`);
  const capturedDiff = fs.existsSync(`${artifactBase}.diff`)
    ? fs.readFileSync(`${artifactBase}.diff`, "utf8")
    : "";
  const capturedReport = fs.existsSync(`${artifactBase}.json`)
    ? JSON.parse(fs.readFileSync(`${artifactBase}.json`, "utf8"))
    : null;
  return {
    ok: true,
    run,
    phase,
    runtime: run.phases[phaseId],
    hardRules: plan.hardRules,
    changedPaths: paths,
    capturedReport,
    capturedDiff: capturedDiff.slice(0, 100_000),
    diff: diff.slice(0, 100_000),
    reviewContract: {
      verdicts: ["accept", "rework", "needs_user"],
      note: "Verify files and commands independently; executor self-report is not acceptance.",
    },
  };
}

export function completeRunV2(args: { runId?: string; note?: string }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  const plan = assertPlanIntegrity(run.planPath);
  if (!allPhasesAccepted(run)) throw new Error("not_all_phases_accepted");
  const holdPath = orchestratorPaths(run.workspace).hold;
  if (fs.existsSync(holdPath)) {
    const hold = JSON.parse(fs.readFileSync(holdPath, "utf8")) as { status?: string };
    if (hold.status === "open") throw new Error("human_hold_open");
  }
  const acceptance = runCommands(plan.globalAcceptanceCommands, run.workspace);
  if (acceptance.some((item) => !item.ok)) {
    throw new Error(`final_acceptance_failed: ${acceptance.filter((item) => !item.ok).map((item) => item.command).join(", ")}`);
  }
  atomicWriteJson(path.join(runDirectory(run.workspace, run.id), "artifacts", "final-acceptance.json"), acceptance);
  const out = mutateRun(run.workspace, run.id, (current) => {
    current.status = "completed";
    current.summary = args.note || "Codex final acceptance passed";
    current.authorizedPhaseIds = [];
    updatePlanLifecycle(current.planPath, "completed");
    return {
      result: { completed: true },
      events: [{ type: "run.completed" as const, payload: { note: current.summary } }],
    };
  });
  return { ok: true, plan: plan.metadata.task, acceptance, ...out };
}

function runCommands(commands: string[], cwd: string) {
  const shell = process.env.SHELL && path.isAbsolute(process.env.SHELL)
    ? process.env.SHELL
    : "/bin/sh";
  return commands.map((command) => {
    try {
      const output = execFileSync(shell, ["-lc", command], {
        cwd,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { command, ok: true, exitCode: 0, output: output.slice(-8_000) };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
      return {
        command,
        ok: false,
        exitCode: failure.status ?? 1,
        output: `${failure.stdout || ""}${failure.stderr || ""}`.slice(-8_000),
        error: failure.message,
      };
    }
  });
}

export function runPhaseAcceptanceV2(args: { runId?: string; phaseId: string }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  const plan = assertPlanIntegrity(run.planPath);
  const phase = plan.phases.find((item) => item.id === args.phaseId);
  if (!phase) throw new Error(`phase_not_found: ${args.phaseId}`);
  const results = runCommands(phase.acceptanceCommands, run.workspace);
  atomicWriteJson(
    path.join(runDirectory(run.workspace, run.id), "artifacts", `${phase.id}-attempt-${run.phases[phase.id].attempt}-acceptance.json`),
    results,
  );
  return { ok: results.every((item) => item.ok), runId: run.id, phaseId: phase.id, results };
}

export function pauseRunV2(args: { runId?: string; reason?: string }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  const out = mutateRun(run.workspace, run.id, (current) => {
    if (current.status === "completed" || current.status === "cancelled") {
      throw new Error(`run_terminal: ${current.status}`);
    }
    current.status = "paused";
    current.authorizedPhaseIds = [];
    current.summary = args.reason || "Paused by Codex/user";
    updatePlanLifecycle(current.planPath, "paused");
    return { result: { paused: true }, events: [{ type: "run.paused" as const, payload: { reason: current.summary } }] };
  });
  return { ok: true, ...out };
}

export function resumeRunV2(args: { runId?: string }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  const holdPath = orchestratorPaths(run.workspace).hold;
  if (fs.existsSync(holdPath)) {
    const hold = JSON.parse(fs.readFileSync(holdPath, "utf8")) as { status?: string };
    if (hold.status === "open") throw new Error("human_hold_open");
  }
  const out = mutateRun(run.workspace, run.id, (current) => {
    if (current.status !== "paused") throw new Error(`run_not_paused: ${current.status}`);
    current.status = "running";
    delete current.error;
    const plan = assertPlanIntegrity(current.planPath);
    const blocked = plan.phases.find((item) => ["blocked", "attempt_failed", "review_failed"].includes(current.phases[item.id].status));
    const window = blocked ? [blocked.id] : computeAuthorizedWindow(plan, current);
    const events: EventDraft[] = [{ type: "run.resumed" }];
    events.push(...markReady(current, window));
    updatePlanLifecycle(current.planPath, "running");
    return { result: { authorizedPhaseIds: window }, events };
  });
  return { ok: true, ...out };
}

export async function cancelRunV2(args: { runId?: string; reason?: string }): Promise<Record<string, unknown>> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  let abort: { ok: boolean; summary: string } | undefined;
  if (run.sessionId) {
    const orch = loadOrchestratorConfig(repoRoot());
    const resolved = resolveExecutor(run.executorId, orch.default_executor, repoRoot());
    abort = await getAdapter(resolved.def.type).abort({ run: legacyRun(run), options: resolved.def.options });
  }
  const out = mutateRun(run.workspace, run.id, (current) => {
    current.status = "cancelled";
    current.authorizedPhaseIds = [];
    current.summary = args.reason || abort?.summary || "Cancelled";
    updatePlanLifecycle(current.planPath, "cancelled");
    return { result: { cancelled: true, abort } };
  });
  return { ok: true, ...out };
}

export function provideHumanReplyV2(args: { runId?: string; reply: string }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  const holdPath = orchestratorPaths(run.workspace).hold;
  if (!fs.existsSync(holdPath)) throw new Error("no_human_hold");
  const hold = JSON.parse(fs.readFileSync(holdPath, "utf8")) as {
    status?: string;
    runId?: string;
    phaseId?: string;
    attempt?: number;
    keepAlive?: boolean;
  };
  if (hold.status !== "open" || hold.runId !== run.id || !hold.phaseId) {
    throw new Error("hold_run_mismatch_or_resolved");
  }
  const delivered = provideUserReply(run.workspace, args.reply);
  const out = mutateRun(run.workspace, run.id, (current) => {
    const phase = current.phases[hold.phaseId as string];
    if (!phase || phase.status !== "blocked") throw new Error("held_phase_not_blocked");
    if (hold.attempt !== phase.attempt) throw new Error("hold_attempt_mismatch");
    transitionPhase(current, phase.id, hold.keepAlive ? "running" : "ready");
    current.status = "running";
    current.authorizedPhaseIds = [phase.id];
    if (hold.keepAlive) {
      phase.executorReportStatus = "running";
      phase.comment = "human reply delivered through one-time channel; live attempt resumed";
      updateExecutorReport(current.planPath, phase.id, {
        status: "running",
        comment: phase.comment,
        evidence: phase.evidence,
      }, false);
    }
    updatePlanLifecycle(current.planPath, "running");
    return {
      result: { delivered, phaseId: phase.id },
      events: [
        { type: "human.reply_provided" as const, phaseId: phase.id, attempt: phase.attempt },
        ...(hold.keepAlive ? [] : [{ type: "phase.ready" as const, phaseId: phase.id, attempt: phase.attempt }]),
      ],
    };
  });
  return { ok: true, ...out };
}

export function statusV2(args: { runId?: string }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  guardRunPlan(run);
  const plan = parsePlan(run.planPath);
  return {
    ok: true,
    run,
    plan: {
      task: plan.metadata.task,
      status: plan.metadata.status,
      integrity: plan.metadata.specHash === plan.computedSpecHash,
    },
    phases: plan.phases.map((phase) => ({
      title: phase.title,
      checked: phase.checked,
      ...run.phases[phase.id],
    })),
    recentEvents: readEvents(run.workspace, run.id).slice(-20),
  };
}

export function pendingSupervisorEventsV2(args: { runId?: string }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  const cursor = readReviewCursor(run.workspace, run.id);
  const actionable = new Set([
    "phase.implemented",
    "phase.blocked",
    "phase.attempt_failed",
    "protocol.violation",
  ]);
  const events = readEvents(run.workspace, run.id, cursor).filter((event) => actionable.has(event.type));
  return { ok: true, runId: run.id, cursor, events };
}

export function acknowledgeSupervisorEventV2(args: { runId?: string; seq: number }): Record<string, unknown> {
  const run = resolveRun(args.runId);
  const current = readReviewCursor(run.workspace, run.id);
  if (!Number.isInteger(args.seq) || args.seq < current || args.seq >= run.nextSeq) {
    throw new Error(`invalid_cursor: ${args.seq}`);
  }
  writeReviewCursor(run.workspace, run.id, args.seq);
  return { ok: true, runId: run.id, cursor: args.seq };
}

export function listRunsV2(): Record<string, unknown> {
  const bound = requireBoundWorkspace();
  return { ok: true, workspace: bound.absPath, runs: listRuns(bound.absPath) };
}

export function assertV2PathInsideWorkspace(filePath: string): void {
  assertInsideBound(filePath, requireBoundWorkspace(), "v2 path");
}
