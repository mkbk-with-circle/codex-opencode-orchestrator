import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RunState, RunStatus } from "./types.js";
import { repoRoot } from "./config.js";

/** Per-run state lives under the bound business workspace. */
export function runsDir(workspaceAbs: string): string {
  return path.join(workspaceAbs, ".orchestrator", "runs");
}

export function newRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-${randomUUID().slice(0, 8)}`;
}

export function runDir(id: string, workspaceAbs: string): string {
  return path.join(runsDir(workspaceAbs), id);
}

export function statePath(id: string, workspaceAbs: string): string {
  return path.join(runDir(id, workspaceAbs), "state.json");
}

export function writeState(state: RunState, workspaceAbs: string): void {
  const dir = runDir(state.id, workspaceAbs);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(statePath(state.id, workspaceAbs), JSON.stringify(state, null, 2));
}

export function readState(id: string, workspaceAbs: string): RunState {
  const p = statePath(id, workspaceAbs);
  if (!fs.existsSync(p)) throw new Error(`Run not found: ${id}`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as RunState;
}

export function findActiveRun(workspaceAbs: string): RunState | null {
  const dir = runsDir(workspaceAbs);
  if (!fs.existsSync(dir)) return null;
  const active: RunStatus[] = [
    "awaiting_confirm",
    "starting",
    "running",
    "awaiting_review",
    "stalled",
  ];
  const ids = fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(statePath(name, workspaceAbs)))
    .sort()
    .reverse();
  for (const id of ids) {
    const s = readState(id, workspaceAbs);
    if (active.includes(s.status)) return s;
  }
  return null;
}

export function latestRun(workspaceAbs: string): RunState | null {
  const dir = runsDir(workspaceAbs);
  if (!fs.existsSync(dir)) return null;
  const ids = fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(statePath(name, workspaceAbs)))
    .sort()
    .reverse();
  if (!ids.length) return null;
  return readState(ids[0], workspaceAbs);
}

export function readText(relOrAbs: string, root = repoRoot()): string {
  const p = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(root, relOrAbs);
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return fs.readFileSync(p, "utf8");
}

/** Whether to persist briefs on disk. Default: save. */
export function shouldSaveBriefs(saveBriefsConfig?: boolean): boolean {
  const env = process.env.ORCHESTRATOR_SAVE_BRIEFS ?? process.env.SAVE_BRIEFS;
  if (env !== undefined && env.trim() !== "") {
    return !/^(0|false|no|off)$/i.test(env.trim());
  }
  return saveBriefsConfig !== false;
}

/**
 * Write brief under `{workspaceAbs}/.orchestrator/briefs/<id>.md`.
 * Returns absolute path, or null when saving is disabled.
 */
export function writeBrief(
  id: string,
  content: string,
  workspaceAbs: string,
  opts?: { save?: boolean },
): string | null {
  if (opts?.save === false) return null;
  const briefPath = path.join(workspaceAbs, ".orchestrator", "briefs", `${id}.md`);
  fs.mkdirSync(path.dirname(briefPath), { recursive: true });
  fs.writeFileSync(briefPath, content);
  return briefPath;
}
