import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./config.js";

export type WorkspaceResolve = {
  /** Absolute path OpenCode will use as cwd */
  absPath: string;
  /** How it was chosen */
  source:
    | "dispatch_arg"
    | "plan_frontmatter"
    | "env"
    | "user_config"
    | "orchestrator_default";
  /** Relative label stored on RunState (abs path or relative to orchestrator) */
  label: string;
  /** Outside orchestrator repo → usually skip orchestrator git worktree */
  isExternal: boolean;
};

function userWorkspaceConfigPath(): string {
  return path.join(
    process.env.HOME || "",
    ".config/codex-opencode-orchestrator/workspace.env",
  );
}

function localWorkspaceConfigPath(root = repoRoot()): string {
  return path.join(root, "config/workspace.local.yaml");
}

function readKeyValueFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    // yaml-ish: key: value  or KEY=value
    const m = t.match(/^([A-Za-z0-9_]+)\s*[:=]\s*(.+)$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    out[m[1]] = v;
  }
  return out;
}

/** Extract optional YAML frontmatter workspace from plan markdown */
export function parsePlanWorkspace(plan: string): string | undefined {
  if (!plan.startsWith("---")) return undefined;
  const end = plan.indexOf("\n---", 3);
  if (end < 0) return undefined;
  const fm = plan.slice(3, end);
  const m = fm.match(/^(?:workspace|target_workspace)\s*:\s*(.+)$/m);
  if (!m) return undefined;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(process.env.HOME || "", p.slice(2));
  return p;
}

/**
 * Resolve OpenCode working directory.
 * Priority: dispatch arg > plan frontmatter > env > user config > orchestrator default
 */
export function resolveTargetWorkspace(args: {
  dispatchWorkspace?: string;
  planText?: string;
  orchDefault: string;
  useWorktree: boolean;
  root?: string;
}): WorkspaceResolve & { useWorktree: boolean } {
  const root = args.root ?? repoRoot();
  let raw: string | undefined;
  let source: WorkspaceResolve["source"] = "orchestrator_default";

  if (args.dispatchWorkspace?.trim()) {
    raw = args.dispatchWorkspace.trim();
    source = "dispatch_arg";
  } else if (args.planText) {
    const fromPlan = parsePlanWorkspace(args.planText);
    if (fromPlan) {
      raw = fromPlan;
      source = "plan_frontmatter";
    }
  }

  if (!raw) {
    const env =
      process.env.ORCHESTRATOR_TARGET_WORKSPACE ||
      process.env.TARGET_WORKSPACE;
    if (env?.trim()) {
      raw = env.trim();
      source = "env";
    }
  }

  if (!raw) {
    const user = readKeyValueFile(userWorkspaceConfigPath());
    const local = readKeyValueFile(localWorkspaceConfigPath(root));
    const v =
      user.ORCHESTRATOR_TARGET_WORKSPACE ||
      user.TARGET_WORKSPACE ||
      user.workspace ||
      local.ORCHESTRATOR_TARGET_WORKSPACE ||
      local.TARGET_WORKSPACE ||
      local.workspace;
    if (v?.trim()) {
      raw = v.trim();
      source = "user_config";
    }
  }

  if (!raw) {
    raw = args.orchDefault || "playground";
    source = "orchestrator_default";
  }

  raw = expandHome(raw);
  const absPath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const isExternal =
    path.resolve(absPath) !== path.resolve(root) &&
    !absPath.startsWith(root + path.sep);

  if (!fs.existsSync(absPath)) {
    throw new Error(
      `目标工作目录不存在: ${absPath}（source=${source}）。请先创建该目录，或运行 bash scripts/set-workspace.sh <路径>`,
    );
  }
  if (!fs.statSync(absPath).isDirectory()) {
    throw new Error(`目标工作目录不是文件夹: ${absPath}`);
  }

  // External projects: do not clone orchestrator worktree into them by default
  const useWorktree = isExternal ? false : args.useWorktree;

  const label = isExternal ? absPath : path.relative(root, absPath) || ".";

  return { absPath, source, label, isExternal, useWorktree };
}

export function setUserTargetWorkspace(absOrTilde: string): {
  ok: boolean;
  path: string;
  configPath: string;
} {
  const expanded = path.resolve(expandHome(absOrTilde.trim()));
  if (!fs.existsSync(expanded) || !fs.statSync(expanded).isDirectory()) {
    throw new Error(`目录不存在: ${expanded}`);
  }
  const cfg = userWorkspaceConfigPath();
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(
    cfg,
    `# OpenCode 默认目标工作目录（编排仓以外的真实项目）\nTARGET_WORKSPACE=${expanded}\n`,
    { mode: 0o600 },
  );
  return { ok: true, path: expanded, configPath: cfg };
}

export function getUserTargetWorkspace(): {
  path: string | null;
  configPath: string;
  env: string | null;
} {
  const env =
    process.env.ORCHESTRATOR_TARGET_WORKSPACE ||
    process.env.TARGET_WORKSPACE ||
    null;
  const user = readKeyValueFile(userWorkspaceConfigPath());
  const fromFile =
    user.TARGET_WORKSPACE ||
    user.ORCHESTRATOR_TARGET_WORKSPACE ||
    user.workspace ||
    null;
  return {
    path: env || fromFile,
    configPath: userWorkspaceConfigPath(),
    env,
  };
}
