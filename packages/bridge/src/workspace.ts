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

/** Explicit bind only: env or user workspace.env — never orchestrator playground default. */
export type BoundWorkspace = {
  absPath: string;
  source: "env" | "user_config";
  configPath: string;
  plansDir: string;
};

export const BIND_REQUIRED_CODE = "workspace_not_bound";

export function bindRequiredError(): Error {
  const err = new Error(
    `未绑定业务工作目录（${BIND_REQUIRED_CODE}）。请先调用 MCP set_workspace，或运行: bash scripts/set-workspace.sh /绝对路径/到业务项目。绑定后 plan/dispatch/supervise/review 才会放行，且一律只在该目录工作。`,
  );
  (err as Error & { code?: string }).code = BIND_REQUIRED_CODE;
  return err;
}

/**
 * Bound workspace = TARGET_WORKSPACE env or ~/.config/.../workspace.env.
 * Does NOT fall back to orchestrator default (playground).
 */
export function getBoundWorkspace(root = repoRoot()): BoundWorkspace | null {
  const user = getUserTargetWorkspace();
  let raw: string | null = null;
  let source: BoundWorkspace["source"] = "user_config";

  if (user.env?.trim()) {
    raw = user.env.trim();
    source = "env";
  } else {
    const file = readKeyValueFile(userWorkspaceConfigPath());
    const fromFile =
      file.TARGET_WORKSPACE ||
      file.ORCHESTRATOR_TARGET_WORKSPACE ||
      file.workspace ||
      null;
    if (fromFile?.trim()) {
      raw = fromFile.trim();
      source = "user_config";
    }
  }

  if (!raw) return null;

  raw = expandHome(raw);
  const absPath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
    throw new Error(
      `已配置的绑定目录无效或不存在: ${absPath}。请重新 set_workspace。`,
    );
  }

  return {
    absPath,
    source,
    configPath: userWorkspaceConfigPath(),
    plansDir: path.join(absPath, ".orchestrator", "plans"),
  };
}

export function requireBoundWorkspace(root = repoRoot()): BoundWorkspace {
  const bound = getBoundWorkspace(root);
  if (!bound) throw bindRequiredError();
  return bound;
}

/** Plans live under the bound business workspace. */
export function ensureBoundPlansDir(bound: BoundWorkspace): string {
  fs.mkdirSync(bound.plansDir, { recursive: true });
  return bound.plansDir;
}

export function assertInsideBound(
  fileAbs: string,
  bound: BoundWorkspace,
  label = "path",
): void {
  const file = path.resolve(fileAbs);
  const root = bound.absPath.endsWith(path.sep)
    ? bound.absPath
    : bound.absPath + path.sep;
  if (file !== bound.absPath && !file.startsWith(root)) {
    throw new Error(
      `${label} 必须位于已绑定工作目录内: ${bound.absPath}（收到: ${file}）`,
    );
  }
}

/**
 * Resolve a plan path relative to bound `.orchestrator/plans/`, or absolute under bound.
 */
export function resolveBoundPlanPath(
  bound: BoundWorkspace,
  planPath?: string,
): string {
  const name = (planPath || "current.md").trim();
  if (path.isAbsolute(name)) {
    assertInsideBound(name, bound, "planPath");
    if (!fs.existsSync(name)) throw new Error(`Plan 不存在: ${name}`);
    return name;
  }
  const base = path.basename(name);
  const candidates = [
    path.join(bound.plansDir, name),
    path.join(bound.plansDir, base),
    path.join(bound.absPath, "plans", name),
    path.join(bound.absPath, name),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      assertInsideBound(c, bound, "planPath");
      return c;
    }
  }
  throw new Error(
    `在绑定目录未找到 plan: ${name}。请先 $opencode-plan / write_plan 写入 ${bound.plansDir}/`,
  );
}

/** Sanitize task slug for plan filenames */
export function sanitizePlanTaskName(task: string): string {
  const s = task
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!s) throw new Error("task 名称无效");
  return s.endsWith(".md") ? s : `${s}.md`;
}
