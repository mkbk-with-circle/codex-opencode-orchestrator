import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { OrchestratorConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: packages/bridge/src -> ../../.. */
export function repoRoot(): string {
  const fromEnv = process.env.ORCHESTRATOR_ROOT;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(__dirname, "../../..");
}

export function loadDotEnv(root = repoRoot()): void {
  // User-level workspace + secrets (Codex App 不一定继承 zshrc)
  const home = process.env.HOME || "";
  loadEnvFile(path.join(home, ".config/codex-opencode-orchestrator/workspace.env"));
  loadEnvFile(path.join(home, ".config/codex-opencode-orchestrator/secrets.env"));
  loadEnvFile(path.join(root, ".env"));
}

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function loadOrchestratorConfig(root = repoRoot()): OrchestratorConfig {
  const p = path.join(root, "config/orchestrator.yaml");
  const raw = yaml.load(fs.readFileSync(p, "utf8")) as OrchestratorConfig;
  return raw;
}
