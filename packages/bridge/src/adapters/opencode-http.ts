import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ExecutorActivity,
  ExecutorAdapter,
  PollResult,
  RunState,
  StartResult,
} from "../types.js";
import { repoRoot } from "../config.js";

let serveProc: ChildProcess | null = null;

function baseUrl(options: Record<string, unknown>): string {
  const envKey = (options.baseUrlEnv as string) || "OPENCODE_BASE_URL";
  return (
    process.env[envKey] ||
    (options.defaultBaseUrl as string) ||
    "http://127.0.0.1:4096"
  );
}

type LocalServerAuth = { username: string; password: string };

function localAuthPath(): string {
  return path.join(repoRoot(), ".orchestrator", "opencode-server-auth.json");
}

function isLoopback(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function readLocalServerAuth(): LocalServerAuth | null {
  try {
    const value = JSON.parse(fs.readFileSync(localAuthPath(), "utf8")) as LocalServerAuth;
    return value.username && value.password ? value : null;
  } catch {
    return null;
  }
}

function ensureLocalServerAuth(url: string): LocalServerAuth | null {
  if (!isLoopback(url)) return null;
  if (process.env.OPENCODE_SERVER_PASSWORD) {
    return {
      username: process.env.OPENCODE_SERVER_USERNAME || "opencode",
      password: process.env.OPENCODE_SERVER_PASSWORD,
    };
  }
  const existing = readLocalServerAuth();
  if (existing) return existing;
  const value = { username: "opencode", password: randomBytes(32).toString("base64url") };
  const file = localAuthPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return value;
}

function authHeaders(url: string): Record<string, string> {
  const local = isLoopback(url) ? readLocalServerAuth() : null;
  const password = process.env.OPENCODE_SERVER_PASSWORD || local?.password;
  if (!password) return {};
  const user = process.env.OPENCODE_SERVER_USERNAME || local?.username || "opencode";
  const token = Buffer.from(`${user}:${password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

function withDirectory(url: string, directory?: string): string {
  if (!directory) return url;
  const u = new URL(url);
  u.searchParams.set("directory", directory);
  return u.toString();
}

async function httpJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const timeoutMs = Math.max(1_000, Number(process.env.OPENCODE_HTTP_TIMEOUT_MS || 30_000));
  const attempts = !init?.method || init.method === "GET" ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: init?.signal || AbortSignal.timeout(timeoutMs),
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(url),
          ...(init?.headers || {}),
        },
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.status >= 500 && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        continue;
      }
      return { ok: res.ok, status: res.status, json, text };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        continue;
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`opencode_http_unreachable: ${url}: ${detail}`);
}

async function ensureServe(options: Record<string, unknown>): Promise<void> {
  const url = baseUrl(options);
  try {
    const health = await httpJson(`${url}/global/health`);
    if (health.ok) {
      await ensureReporter(url);
      return;
    }
  } catch {
    // not up
  }
  if (!options.autoStartServe) {
    throw new Error(
      `OpenCode serve not reachable at ${url}. Start it or set autoStartServe.`,
    );
  }
  if (serveProc && !serveProc.killed) return;
  const port = Number(options.servePort || 4096);
  const root = repoRoot();
  const localAuth = ensureLocalServerAuth(url);
  const env = {
    ...process.env,
    ORCHESTRATOR_ROOT: root,
    OPENCODE_CONFIG: path.join(root, "opencode.json"),
    ...(localAuth ? {
      OPENCODE_SERVER_USERNAME: localAuth.username,
      OPENCODE_SERVER_PASSWORD: localAuth.password,
    } : {}),
    PATH: `${process.env.HOME}/.opencode/bin:${process.env.PATH || ""}`,
  };
  const executable = String(options.opencodeBin || process.env.OPENCODE_BIN || "opencode");
  serveProc = spawn(executable, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    stdio: "ignore",
    detached: true,
    env,
    cwd: root,
  });
  serveProc.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const health = await httpJson(`${url}/global/health`);
      if (health.ok) {
        await ensureReporter(url);
        return;
      }
    } catch {
      // retry
    }
  }
  throw new Error(`Timed out waiting for opencode serve on ${url}`);
}

function reporterConnected(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const entry = (value as Record<string, unknown>).orchestrator_reporter;
  if (!entry || typeof entry !== "object") return false;
  const status = String((entry as Record<string, unknown>).status || "").toLowerCase();
  return ["connected", "ready", "running"].includes(status);
}

async function ensureReporter(url: string): Promise<void> {
  const current = await httpJson(`${url}/mcp`);
  if (current.ok && reporterConnected(current.json)) return;
  const script = `${repoRoot()}/scripts/mcp-executor.sh`;
  const added = await httpJson(`${url}/mcp`, {
    method: "POST",
    body: JSON.stringify({
      name: "orchestrator_reporter",
      config: {
        type: "local",
        command: ["bash", script],
        enabled: true,
        timeout: 3_600_000,
      },
    }),
  });
  if (!added.ok) throw new Error(`opencode_reporter_setup_failed: ${added.status} ${added.text}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await httpJson(`${url}/mcp`);
    if (status.ok && reporterConnected(status.json)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("opencode_reporter_unavailable: check scripts/mcp-executor.sh and OpenCode MCP logs");
}

export class OpenCodeHttpExecutor implements ExecutorAdapter {
  readonly type = "opencode-http";

  async start(args: {
    run: RunState;
    brief: string;
    workspace: string;
    options: Record<string, unknown>;
  }): Promise<StartResult> {
    await ensureServe(args.options);
    const url = baseUrl(args.options);
    const model = String(args.options.model || "");
    const agent = String(args.options.agent || "build");
    const directory = args.workspace;

    const created = await httpJson(withDirectory(`${url}/session`, directory), {
      method: "POST",
      body: JSON.stringify({ title: `orchestrator-${args.run.id}` }),
    });
    if (!created.ok) {
      throw new Error(`Create session failed: ${created.status} ${created.text}`);
    }
    const session = created.json as { id?: string; directory?: string };
    const sessionId = session.id;
    if (!sessionId) throw new Error("OpenCode session missing id");
    if (session.directory && session.directory !== directory) {
      throw new Error(
        `OpenCode session directory mismatch: wanted ${directory}, got ${session.directory}`,
      );
    }

    const prompt = [
      "You are the executor for a Codex-orchestrated task.",
      "Follow the brief exactly. Stay in scope. Do not expand work.",
      "",
      `Workspace directory (MUST work only here): ${directory}`,
      "Prefer editing files under that workspace.",
      "",
      "## Brief",
      args.brief,
      "",
      "When your phases are done, reply with a one-line PHASES_DONE summary.",
      "Do NOT declare the overall task complete — Codex will review and mark_complete.",
    ].join("\n");

    const body: Record<string, unknown> = {
      agent,
      parts: [{ type: "text", text: prompt }],
    };
    if (model) {
      body.model = model.includes("/")
        ? {
            providerID: model.split("/")[0],
            modelID: model.split("/").slice(1).join("/"),
          }
        : model;
    }

    const sent = await httpJson(
      withDirectory(`${url}/session/${sessionId}/prompt_async`, directory),
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    if (!sent.ok && sent.status !== 204) {
      const fallback = await httpJson(
        withDirectory(`${url}/session/${sessionId}/message`, directory),
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      if (!fallback.ok) {
        throw new Error(
          `Prompt failed: async=${sent.status} message=${fallback.status} ${fallback.text}`,
        );
      }
    }

    return {
      sessionId,
      summary: `OpenCode session ${sessionId} in ${directory} (model=${model || "default"})`,
    };
  }

  async poll(args: {
    run: RunState;
    options: Record<string, unknown>;
  }): Promise<PollResult> {
    const url = baseUrl(args.options);
    const sid = args.run.sessionId;
    if (!sid) {
      return {
        activity: "failed",
        status: "failed",
        summary: "missing sessionId",
      };
    }
    const directory = resolveRunDirectory(args.run);

    let busy = false;
    try {
      const st = await httpJson(withDirectory(`${url}/session/status`, directory));
      if (st.ok && st.json && typeof st.json === "object") {
        const map = st.json as Record<string, { type?: string } | string>;
        const entry = map[sid];
        const t =
          typeof entry === "string"
            ? entry
            : entry && typeof entry === "object"
              ? entry.type
              : undefined;
        busy = t === "busy" || t === "running" || t === "retry";
      }
    } catch {
      // ignore
    }

    let todo: unknown = undefined;
    try {
      const t = await httpJson(
        withDirectory(`${url}/session/${sid}/todo`, directory),
      );
      if (t.ok) todo = t.json;
    } catch {
      // ignore
    }

    let diffSummary = "";
    try {
      const d = await httpJson(
        withDirectory(`${url}/session/${sid}/diff`, directory),
      );
      if (d.ok && Array.isArray(d.json)) {
        const diffs = d.json as Array<{ path?: string; file?: string }>;
        diffSummary = diffs
          .map((x) => x.path || x.file || "?")
          .slice(0, 20)
          .join(", ");
      }
    } catch {
      // ignore
    }

    let lastText = "";
    try {
      const msgs = await httpJson(
        withDirectory(`${url}/session/${sid}/message?limit=8`, directory),
      );
      if (msgs.ok && Array.isArray(msgs.json)) {
        const last = msgs.json[msgs.json.length - 1] as {
          parts?: Array<{ type?: string; text?: string }>;
        };
        const text = last?.parts?.find((p) => p.type === "text" || p.text)?.text;
        if (text) lastText = text.slice(0, 400);
      }
    } catch {
      // ignore
    }

    const seenBusy = Boolean(args.run.seenBusy) || busy;
    const sentAt = args.run.promptSentAt
      ? Date.parse(args.run.promptSentAt)
      : Date.parse(args.run.updatedAt || args.run.createdAt);
    const ageMs = Number.isFinite(sentAt) ? Date.now() - sentAt : 0;

    // OpenCode idle ≠ 任务完成。任务完成只能由 Codex mark_complete。
    let activity: ExecutorActivity;

    let status: PollResult["status"];
    let summary: string;
    let progress: string;
    if (busy) {
      activity = "busy";
      status = "running";
      summary = "OpenCode busy (phases only; Codex judges final completion)";
      progress = lastText || "OpenCode busy";
    } else if (seenBusy) {
      activity = "idle";
      status = "awaiting_review";
      summary =
        "OpenCode idle — awaiting Codex review (check plan phase boxes; do NOT treat as completed)";
      progress = lastText || "OpenCode idle — awaiting Codex review";
    } else if (ageMs < 90_000) {
      activity = "idle";
      status = "running";
      summary = "waiting for OpenCode to start (not busy yet)";
      progress =
        lastText ||
        `OpenCode idle — waiting to become busy (${Math.round(ageMs / 1000)}s)`;
    } else {
      activity = "stalled";
      status = "stalled";
      summary =
        "OpenCode never became busy — check IKUNCODE_API_KEY / model id / opencode serve logs";
      progress = lastText || summary;
    }

    return {
      activity,
      status,
      progress,
      summary,
      todo,
      diffSummary,
      seenBusy,
    };
  }

  async abort(args: {
    run: RunState;
    options: Record<string, unknown>;
  }): Promise<{ ok: boolean; summary: string }> {
    const url = baseUrl(args.options);
    const sid = args.run.sessionId;
    if (!sid) return { ok: false, summary: "missing sessionId" };
    const directory = resolveRunDirectory(args.run);
    const res = await httpJson(
      withDirectory(`${url}/session/${sid}/abort`, directory),
      { method: "POST" },
    );
    return {
      ok: res.ok,
      summary: res.ok ? `Aborted ${sid}` : `Abort failed: ${res.status} ${res.text}`,
    };
  }

  async progress(args: {
    run: RunState;
    options: Record<string, unknown>;
    prompt?: string;
    model?: string;
  }): Promise<{ progress: string }> {
    await ensureServe(args.options);
    const url = baseUrl(args.options);
    const sid = args.run.sessionId;
    if (!sid) return { progress: "missing sessionId" };
    const directory = resolveRunDirectory(args.run);
    const text =
      args.prompt ||
      "Pause coding briefly. Reply in under 10 lines with: current step, files touched, next step. Then continue the original brief without restarting from scratch.";
    const model = String(args.model || args.options.model || args.run.model || "");
    const body: Record<string, unknown> = {
      parts: [{ type: "text", text }],
      noReply: false,
    };
    if (model) {
      body.model = model.includes("/")
        ? {
            providerID: model.split("/")[0],
            modelID: model.split("/").slice(1).join("/"),
          }
        : model;
    }
    const asyncRes = await httpJson(
      withDirectory(`${url}/session/${sid}/prompt_async`, directory),
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    if (!asyncRes.ok && asyncRes.status !== 204) {
      await httpJson(withDirectory(`${url}/session/${sid}/message`, directory), {
        method: "POST",
        body: JSON.stringify(body),
      });
    }
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await this.poll({ run: args.run, options: args.options });
    return { progress: poll.progress || "progress requested" };
  }
}

function resolveRunDirectory(run: RunState): string | undefined {
  const w = run.workspace;
  if (!w) return undefined;
  if (w.startsWith("/")) return w;
  const root = process.env.ORCHESTRATOR_ROOT;
  if (root) return `${root.replace(/\/$/, "")}/${w}`;
  return w;
}
