import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RunState, RunStatus } from "./types.js";
import { repoRoot } from "./config.js";

export function runsDir(root = repoRoot()): string {
  return path.join(root, "runs");
}

export function newRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${ts}-${randomUUID().slice(0, 8)}`;
}

export function runDir(id: string, root = repoRoot()): string {
  return path.join(runsDir(root), id);
}

export function statePath(id: string, root = repoRoot()): string {
  return path.join(runDir(id, root), "state.json");
}

export function writeState(state: RunState, root = repoRoot()): void {
  const dir = runDir(state.id, root);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(statePath(state.id, root), JSON.stringify(state, null, 2));
}

export function readState(id: string, root = repoRoot()): RunState {
  const p = statePath(id, root);
  if (!fs.existsSync(p)) throw new Error(`Run not found: ${id}`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as RunState;
}

export function findActiveRun(root = repoRoot()): RunState | null {
  const dir = runsDir(root);
  if (!fs.existsSync(dir)) return null;
  const active: RunStatus[] = [
    "awaiting_confirm",
    "starting",
    "running",
    "stalled",
  ];
  const ids = fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(statePath(name, root)))
    .sort()
    .reverse();
  for (const id of ids) {
    const s = readState(id, root);
    if (active.includes(s.status)) return s;
  }
  return null;
}

export function latestRun(root = repoRoot()): RunState | null {
  const dir = runsDir(root);
  if (!fs.existsSync(dir)) return null;
  const ids = fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(statePath(name, root)))
    .sort()
    .reverse();
  if (!ids.length) return null;
  return readState(ids[0], root);
}

export function readText(relOrAbs: string, root = repoRoot()): string {
  const p = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(root, relOrAbs);
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return fs.readFileSync(p, "utf8");
}

export function writeBrief(id: string, content: string, root = repoRoot()): string {
  const briefPath = path.join(root, "briefs", `${id}.md`);
  fs.mkdirSync(path.dirname(briefPath), { recursive: true });
  fs.writeFileSync(briefPath, content);
  return briefPath;
}
