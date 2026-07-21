import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireBoundWorkspace, type BoundWorkspace } from "./workspace.js";

export type HoldKind =
  | "otp"
  | "credentials"
  | "decision"
  | "2fa"
  | "captcha"
  | "device"
  | "cli"
  | "process"
  | "browser"
  | "secret"
  | "other";

export type HoldMeta = {
  status: "open" | "resolved";
  kind: HoldKind | string;
  keepAlive: boolean;
  replyFile: string;
  waitToken: string;
  holdHint?: string;
  createdAt: string;
  runId?: string;
};

const DEFAULT_REPLY_REL = path.join(".orchestrator", "user-reply.md");
const DEFAULT_NEEDS_REL = path.join(".orchestrator", "needs-user.md");
const DEFAULT_HOLD_REL = path.join(".orchestrator", "hold.json");

export function orchestratorPaths(workspaceAbs: string) {
  return {
    needsUser: path.join(workspaceAbs, DEFAULT_NEEDS_REL),
    userReply: path.join(workspaceAbs, DEFAULT_REPLY_REL),
    hold: path.join(workspaceAbs, DEFAULT_HOLD_REL),
    dir: path.join(workspaceAbs, ".orchestrator"),
  };
}

function ensureOrchDir(workspaceAbs: string): void {
  fs.mkdirSync(path.join(workspaceAbs, ".orchestrator"), { recursive: true });
}

/** Clear previous reply and write a wait token so waiters ignore stale content. */
export function beginUserHold(
  workspaceAbs: string,
  args: {
    kind?: HoldKind | string;
    keepAlive?: boolean;
    holdHint?: string;
    question?: string;
    needWhat?: string;
    runId?: string;
  } = {},
): HoldMeta {
  ensureOrchDir(workspaceAbs);
  const paths = orchestratorPaths(workspaceAbs);
  const meta: HoldMeta = {
    status: "open",
    kind: args.kind || "other",
    keepAlive: args.keepAlive !== false,
    replyFile: DEFAULT_REPLY_REL,
    waitToken: randomUUID(),
    holdHint: args.holdHint,
    createdAt: new Date().toISOString(),
    runId: args.runId,
  };

  fs.writeFileSync(paths.hold, JSON.stringify(meta, null, 2) + "\n", "utf8");
  // Stale replies must not unblock a new wait
  fs.writeFileSync(
    paths.userReply,
    [
      "---",
      `waitToken: ${meta.waitToken}`,
      "status: waiting",
      "---",
      "",
      "# waiting for human reply",
      "",
    ].join("\n"),
    "utf8",
  );

  const body = [
    "---",
    `status: open`,
    `kind: ${meta.kind}`,
    `keepAlive: ${meta.keepAlive}`,
    `replyFile: ${meta.replyFile}`,
    `waitToken: ${meta.waitToken}`,
    args.holdHint ? `holdHint: ${JSON.stringify(args.holdHint)}` : null,
    `createdAt: ${meta.createdAt}`,
    meta.runId ? `runId: ${meta.runId}` : null,
    "---",
    "",
    "# 需要用户提供",
    "",
    "## 问题",
    args.question?.trim() || "执行卡住，需要人工输入后才能在同一会话继续。",
    "",
    "## 需要什么",
    args.needWhat?.trim() || "- （请填写）",
    "",
    "## 现场保持",
    meta.keepAlive
      ? [
          "- keepAlive: true — 执行端必须保持当前会话/进程/浏览器/CLI 现场，禁止重启该步骤",
          meta.holdHint ? `- holdHint: ${meta.holdHint}` : null,
          `- 回复写入: \`${meta.replyFile}\`（由 Codex provide_user_reply / resume 写入）`,
          "- 恢复：同会话 resume；禁止 rework/新 dispatch",
        ]
          .filter(Boolean)
          .join("\n")
      : "- keepAlive: false — 无活现场，可写静态凭据后新派工",
    "",
    "## 安全",
    "不要把真实密钥写进仓库已跟踪文件。",
    "",
  ].join("\n");
  fs.writeFileSync(paths.needsUser, body, "utf8");
  return meta;
}

export function provideUserReply(
  workspaceAbs: string,
  reply: string,
  opts?: { resolveNeedsUser?: boolean },
): { replyPath: string; waitToken?: string } {
  ensureOrchDir(workspaceAbs);
  const paths = orchestratorPaths(workspaceAbs);
  let waitToken: string | undefined;
  if (fs.existsSync(paths.hold)) {
    try {
      const hold = JSON.parse(fs.readFileSync(paths.hold, "utf8")) as HoldMeta;
      waitToken = hold.waitToken;
    } catch {
      /* ignore */
    }
  }
  const text = reply.replace(/\s+$/, "") + "\n";
  const stamped = [
    "---",
    waitToken ? `waitToken: ${waitToken}` : null,
    "status: provided",
    `providedAt: ${new Date().toISOString()}`,
    "---",
    "",
    text,
  ]
    .filter((x) => x !== null)
    .join("\n");
  fs.writeFileSync(paths.userReply, stamped, "utf8");

  if (opts?.resolveNeedsUser !== false && fs.existsSync(paths.needsUser)) {
    const needs = fs.readFileSync(paths.needsUser, "utf8");
    if (/^status:\s*open\b/im.test(needs)) {
      fs.writeFileSync(
        paths.needsUser,
        needs.replace(/^status:\s*open\b/im, "status: resolved"),
        "utf8",
      );
    }
  }
  if (fs.existsSync(paths.hold)) {
    try {
      const hold = JSON.parse(fs.readFileSync(paths.hold, "utf8")) as HoldMeta;
      hold.status = "resolved";
      fs.writeFileSync(paths.hold, JSON.stringify(hold, null, 2) + "\n", "utf8");
    } catch {
      /* ignore */
    }
  }
  return { replyPath: paths.userReply, waitToken };
}

function extractReplyBody(raw: string): string {
  if (!raw.startsWith("---")) return raw.trim();
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return raw.trim();
  return raw.slice(end + 4).replace(/^\s+/, "").trim();
}

function replyIsReady(raw: string, expectedToken?: string): boolean {
  if (/^status:\s*waiting\b/m.test(raw)) return false;
  const body = extractReplyBody(raw);
  if (!body || /^#\s*waiting for human reply/i.test(body)) return false;
  if (expectedToken) {
    const tok = raw.match(/^waitToken:\s*(\S+)/m)?.[1];
    if (tok && tok !== expectedToken) return false;
  }
  return true;
}

/**
 * Block until `.orchestrator/user-reply.md` has a real human reply.
 * OpenCode should call this WHILE keeping browser/process/CLI session alive.
 */
export async function waitForUserReply(
  workspaceAbs: string,
  opts?: {
    timeoutMs?: number;
    pollMs?: number;
    /** Print reply body to stdout when ready (default true) */
    printBody?: boolean;
  },
): Promise<{ ok: boolean; reply?: string; replyPath: string; timedOut?: boolean }> {
  const paths = orchestratorPaths(workspaceAbs);
  ensureOrchDir(workspaceAbs);
  let expectedToken: string | undefined;
  if (fs.existsSync(paths.hold)) {
    try {
      expectedToken = (JSON.parse(fs.readFileSync(paths.hold, "utf8")) as HoldMeta)
        .waitToken;
    } catch {
      /* ignore */
    }
  }

  const timeoutMs = opts?.timeoutMs ?? 15 * 60 * 1000;
  const pollMs = opts?.pollMs ?? 1000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(paths.userReply)) {
      const raw = fs.readFileSync(paths.userReply, "utf8");
      if (replyIsReady(raw, expectedToken)) {
        const reply = extractReplyBody(raw);
        return { ok: true, reply, replyPath: paths.userReply };
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return {
    ok: false,
    timedOut: true,
    replyPath: paths.userReply,
  };
}

export function provideUserReplyTool(args: {
  reply: string;
  resolveNeedsUser?: boolean;
}): Record<string, unknown> {
  const bound = requireBoundWorkspace();
  const out = provideUserReply(bound.absPath, args.reply, {
    resolveNeedsUser: args.resolveNeedsUser,
  });
  return {
    ok: true,
    ...out,
    workspace: bound.absPath,
    message:
      "已写入 user-reply.md。若执行端正在 wait-reply，会自动继续；否则再对同一会话调用 resume。",
  };
}

export async function waitForUserReplyTool(args?: {
  timeoutSec?: number;
  pollMs?: number;
}): Promise<Record<string, unknown>> {
  const bound = requireBoundWorkspace();
  const out = await waitForUserReply(bound.absPath, {
    timeoutMs: (args?.timeoutSec ?? 900) * 1000,
    pollMs: args?.pollMs,
  });
  return {
    ...out,
    workspace: bound.absPath,
    message: out.ok
      ? "收到用户回复（保持现场的 wait 已结束）。继续用同一会话/同一进程完成步骤，不要重启该交互。"
      : "等待用户回复超时。保持现场若仍在，可延长 timeout 再 wait；不要 rework。",
  };
}

export function beginUserHoldTool(args: {
  kind?: string;
  keepAlive?: boolean;
  holdHint?: string;
  question?: string;
  needWhat?: string;
  runId?: string;
}): Record<string, unknown> {
  const bound = requireBoundWorkspace();
  const meta = beginUserHold(bound.absPath, args);
  return {
    ok: true,
    hold: meta,
    paths: orchestratorPaths(bound.absPath),
    workspace: bound.absPath,
    message:
      "已打开人类门禁。请保持当前现场，然后调用 wait_for_user_reply / CLI wait-reply 阻塞等待。",
  };
}

/** @deprecated helper for tests */
export function _boundPaths(bound: BoundWorkspace) {
  return orchestratorPaths(bound.absPath);
}
