import { spawn, type ChildProcess } from "node:child_process";
import type { ExecutorAdapter, PollResult, RunState, StartResult } from "../types.js";

let serveProc: ChildProcess | null = null;

function baseUrl(options: Record<string, unknown>): string {
  const envKey = (options.baseUrlEnv as string) || "OPENCODE_BASE_URL";
  return (
    process.env[envKey] ||
    (options.defaultBaseUrl as string) ||
    "http://127.0.0.1:4096"
  );
}

function authHeaders(): Record<string, string> {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return {};
  const user = process.env.OPENCODE_SERVER_USERNAME || "opencode";
  const token = Buffer.from(`${user}:${password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

async function httpJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
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
  return { ok: res.ok, status: res.status, json, text };
}

async function ensureServe(options: Record<string, unknown>): Promise<void> {
  const url = baseUrl(options);
  try {
    const health = await httpJson(`${url}/global/health`);
    if (health.ok) return;
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
  const env = {
    ...process.env,
    PATH: `${process.env.HOME}/.opencode/bin:${process.env.PATH || ""}`,
  };
  serveProc = spawn("opencode", ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    stdio: "ignore",
    detached: true,
    env,
    cwd: process.env.ORCHESTRATOR_ROOT || undefined,
  });
  serveProc.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const health = await httpJson(`${url}/global/health`);
      if (health.ok) return;
    } catch {
      // retry
    }
  }
  throw new Error(`Timed out waiting for opencode serve on ${url}`);
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

    const created = await httpJson(`${url}/session`, {
      method: "POST",
      body: JSON.stringify({ title: `orchestrator-${args.run.id}` }),
    });
    if (!created.ok) {
      throw new Error(`Create session failed: ${created.status} ${created.text}`);
    }
    const session = created.json as { id?: string };
    const sessionId = session.id;
    if (!sessionId) throw new Error("OpenCode session missing id");

    const prompt = [
      "You are the executor for a Codex-orchestrated task.",
      "Follow the brief exactly. Stay in scope. Do not expand work.",
      "",
      `Workspace directory: ${args.workspace}`,
      "Prefer editing files under that workspace.",
      "",
      "## Brief",
      args.brief,
      "",
      "When finished, reply with a one-line DONE summary.",
    ].join("\n");

    const body: Record<string, unknown> = {
      agent,
      parts: [{ type: "text", text: prompt }],
    };
    if (model) {
      // OpenCode accepts model as provider/model string or object depending on version
      body.model = model.includes("/")
        ? {
            providerID: model.split("/")[0],
            modelID: model.split("/").slice(1).join("/"),
          }
        : model;
    }

    const sent = await httpJson(`${url}/session/${sessionId}/prompt_async`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    // Some versions return 204; older may use /message
    if (!sent.ok && sent.status !== 204) {
      const fallback = await httpJson(`${url}/session/${sessionId}/message`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!fallback.ok) {
        throw new Error(
          `Prompt failed: async=${sent.status} message=${fallback.status} ${fallback.text}`,
        );
      }
    }

    return {
      sessionId,
      summary: `OpenCode session ${sessionId} started (model=${model || "default"})`,
    };
  }

  async poll(args: {
    run: RunState;
    options: Record<string, unknown>;
  }): Promise<PollResult> {
    const url = baseUrl(args.options);
    const sid = args.run.sessionId;
    if (!sid) return { status: "failed", summary: "missing sessionId" };

    let busy = false;
    try {
      const st = await httpJson(`${url}/session/status`);
      if (st.ok && st.json && typeof st.json === "object") {
        const map = st.json as Record<string, { type?: string } | string>;
        const entry = map[sid];
        const t =
          typeof entry === "string"
            ? entry
            : entry && typeof entry === "object"
              ? entry.type
              : undefined;
        busy = t === "busy" || t === "running";
      }
    } catch {
      // ignore
    }

    let todo: unknown = undefined;
    try {
      const t = await httpJson(`${url}/session/${sid}/todo`);
      if (t.ok) todo = t.json;
    } catch {
      // ignore
    }

    let diffSummary = "";
    try {
      const d = await httpJson(`${url}/session/${sid}/diff`);
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

    let progress = busy ? "OpenCode busy" : "OpenCode idle";
    try {
      const msgs = await httpJson(`${url}/session/${sid}/message?limit=5`);
      if (msgs.ok && Array.isArray(msgs.json)) {
        const last = msgs.json[msgs.json.length - 1] as {
          parts?: Array<{ type?: string; text?: string }>;
        };
        const text = last?.parts?.find((p) => p.type === "text" || p.text)?.text;
        if (text) progress = text.slice(0, 400);
      }
    } catch {
      // ignore
    }

    return {
      status: busy ? "running" : "completed",
      progress,
      summary: busy ? "running" : "idle/completed",
      todo,
      diffSummary,
    };
  }

  async abort(args: {
    run: RunState;
    options: Record<string, unknown>;
  }): Promise<{ ok: boolean; summary: string }> {
    const url = baseUrl(args.options);
    const sid = args.run.sessionId;
    if (!sid) return { ok: false, summary: "missing sessionId" };
    const res = await httpJson(`${url}/session/${sid}/abort`, { method: "POST" });
    return {
      ok: res.ok,
      summary: res.ok ? `Aborted ${sid}` : `Abort failed: ${res.status} ${res.text}`,
    };
  }

  async progress(args: {
    run: RunState;
    options: Record<string, unknown>;
    prompt?: string;
  }): Promise<{ progress: string }> {
    const url = baseUrl(args.options);
    const sid = args.run.sessionId;
    if (!sid) return { progress: "missing sessionId" };
    const text =
      args.prompt ||
      "Pause coding briefly. Reply in under 10 lines with: current step, files touched, next step. Then continue the original brief without restarting from scratch.";
    const body = {
      parts: [{ type: "text", text }],
      noReply: false,
    };
    // Prefer async insert so we don't block forever
    const asyncRes = await httpJson(`${url}/session/${sid}/prompt_async`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!asyncRes.ok && asyncRes.status !== 204) {
      await httpJson(`${url}/session/${sid}/message`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    }
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await this.poll({ run: args.run, options: args.options });
    return { progress: poll.progress || "progress requested" };
  }
}
