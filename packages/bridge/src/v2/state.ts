import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson, readJson, withLock } from "./fs.js";
import type {
  EventType,
  PhaseStatus,
  RunEventV2,
  RunStateV2,
} from "./types.js";

export interface EventDraft {
  type: EventType;
  phaseId?: string;
  attempt?: number;
  payload?: Record<string, unknown>;
}

export function runDirectory(workspace: string, runId: string): string {
  return path.join(workspace, ".orchestrator", "runs", runId);
}

export function runStatePath(workspace: string, runId: string): string {
  return path.join(runDirectory(workspace, runId), "state.json");
}

export function eventsPath(workspace: string, runId: string): string {
  return path.join(runDirectory(workspace, runId), "events.jsonl");
}

export function reviewCursorPath(workspace: string, runId: string): string {
  return path.join(runDirectory(workspace, runId), "review-cursor.json");
}

export function runLockPath(workspace: string, runId: string): string {
  return path.join(runDirectory(workspace, runId), "lock");
}

export function writeRun(run: RunStateV2): void {
  run.updatedAt = new Date().toISOString();
  atomicWriteJson(runStatePath(run.workspace, run.id), run, 0o600);
}

export function readRun(workspace: string, runId: string): RunStateV2 {
  const value = readJson<RunStateV2>(runStatePath(workspace, runId));
  if (value.schemaVersion !== 2) throw new Error(`not_v2_run: ${runId}`);
  return value;
}

export function listRuns(workspace: string): RunStateV2[] {
  const dir = path.join(workspace, ".orchestrator", "runs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((id) => runStatePath(workspace, id))
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => {
      try {
        const value = readJson<RunStateV2>(file);
        return value.schemaVersion === 2 ? [value] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function appendEventsUnlocked(run: RunStateV2, drafts: EventDraft[]): RunEventV2[] {
  if (!drafts.length) return [];
  const file = eventsPath(run.workspace, run.id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8");
    if (existing && !existing.endsWith("\n")) {
      const lastComplete = existing.lastIndexOf("\n");
      fs.truncateSync(file, lastComplete < 0 ? 0 : lastComplete + 1);
    }
  }
  const events = drafts.map((draft) => {
    const event: RunEventV2 = {
      eventId: randomUUID(),
      seq: run.nextSeq++,
      type: draft.type,
      runId: run.id,
      phaseId: draft.phaseId,
      attempt: draft.attempt,
      at: new Date().toISOString(),
      payload: draft.payload,
    };
    return event;
  });
  fs.appendFileSync(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  return events;
}

export function createRun(run: RunStateV2): RunEventV2[] {
  const stateFile = runStatePath(run.workspace, run.id);
  if (fs.existsSync(stateFile)) throw new Error(`run_exists: ${run.id}`);
  fs.mkdirSync(runDirectory(run.workspace, run.id), { recursive: true, mode: 0o700 });
  fs.chmodSync(runDirectory(run.workspace, run.id), 0o700);
  return withLock(runLockPath(run.workspace, run.id), () => {
    const events = appendEventsUnlocked(run, [
      { type: "run.started", payload: { planId: run.planId } },
    ]);
    writeRun(run);
    return events;
  });
}

export function mutateRun<T>(
  workspace: string,
  runId: string,
  mutate: (run: RunStateV2) => { result: T; events?: EventDraft[] },
): { run: RunStateV2; result: T; events: RunEventV2[] } {
  return withLock(runLockPath(workspace, runId), () => {
    const run = readRun(workspace, runId);
    const out = mutate(run);
    const events = appendEventsUnlocked(run, out.events || []);
    writeRun(run);
    return { run, result: out.result, events };
  });
}

export function readEvents(
  workspace: string,
  runId: string,
  afterSeq = 0,
): RunEventV2[] {
  const file = eventsPath(workspace, runId);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n");
  if (raw && !raw.endsWith("\n")) lines.pop();
  return lines
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEventV2)
    .filter((event) => event.seq > afterSeq)
    .sort((a, b) => a.seq - b.seq);
}

export function readReviewCursor(workspace: string, runId: string): number {
  const file = reviewCursorPath(workspace, runId);
  if (!fs.existsSync(file)) return 0;
  return readJson<{ seq: number }>(file).seq || 0;
}

export function writeReviewCursor(workspace: string, runId: string, seq: number): void {
  atomicWriteJson(reviewCursorPath(workspace, runId), {
    schemaVersion: 2,
    runId,
    seq,
    updatedAt: new Date().toISOString(),
  }, 0o600);
}

const ALLOWED_TRANSITIONS: Record<PhaseStatus, PhaseStatus[]> = {
  pending: ["ready", "skipped"],
  ready: ["running", "blocked", "attempt_failed"],
  running: ["implemented", "blocked", "attempt_failed"],
  implemented: ["reviewing"],
  reviewing: ["accepted", "review_failed", "blocked"],
  accepted: [],
  blocked: ["ready", "running"],
  attempt_failed: ["ready", "running"],
  review_failed: ["ready", "running"],
  skipped: [],
};

export function transitionPhase(
  run: RunStateV2,
  phaseId: string,
  next: PhaseStatus,
): void {
  const phase = run.phases[phaseId];
  if (!phase) throw new Error(`phase_not_found: ${phaseId}`);
  if (phase.status === next) return;
  if (!ALLOWED_TRANSITIONS[phase.status].includes(next)) {
    throw new Error(`invalid_phase_transition: ${phaseId} ${phase.status} -> ${next}`);
  }
  phase.status = next;
}

export function newestRun(workspace: string): RunStateV2 | null {
  return listRuns(workspace)[0] || null;
}
