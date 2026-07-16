import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExecutorAdapter, PollResult, RunState, StartResult } from "../types.js";

function bridgeRepoRoot(): string {
  // packages/bridge/src/adapters -> repo root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function doneMarker(runId: string): string {
  return path.join(bridgeRepoRoot(), "runs", runId, "artifacts", "mock-done.json");
}

/**
 * Fake executor: completes immediately and optionally mutates hello.txt for demos.
 * Completion is persisted on disk so CLI/MCP processes agree.
 */
export class MockExecutor implements ExecutorAdapter {
  readonly type = "mock";

  async start(args: {
    run: RunState;
    brief: string;
    workspace: string;
  }): Promise<StartResult> {
    const sessionId = `mock-${args.run.id}`;

    const hello = path.join(args.workspace, "hello.txt");
    if (
      fs.existsSync(path.dirname(hello)) &&
      /hello\.txt|Hello from OpenCode/i.test(args.brief)
    ) {
      const prev = fs.existsSync(hello) ? fs.readFileSync(hello, "utf8") : "";
      if (!prev.includes("Hello from OpenCode")) {
        fs.writeFileSync(
          hello,
          prev.trimEnd() + (prev.endsWith("\n") || !prev ? "" : "\n") + "Hello from OpenCode\n",
        );
      }
    }

    const marker = doneMarker(args.run.id);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(
      marker,
      JSON.stringify({
        sessionId,
        workspace: args.workspace,
        at: new Date().toISOString(),
      }),
    );

    return {
      sessionId,
      summary: `Mock executor completed in ${args.workspace}`,
    };
  }

  async poll(args: { run: RunState }): Promise<PollResult> {
    if (args.run.status === "interrupted") {
      return { status: "interrupted", progress: "aborted", summary: "interrupted" };
    }
    if (fs.existsSync(doneMarker(args.run.id))) {
      return {
        status: "completed",
        progress: "Mock work finished",
        summary: "Mock executor completed successfully",
        diffSummary: "mock: possible hello.txt update",
      };
    }
    return {
      status: "running",
      progress: "Mock executor working...",
      summary: "in progress",
    };
  }

  async abort(args: { run: RunState }): Promise<{ ok: boolean; summary: string }> {
    const marker = doneMarker(args.run.id);
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
    return { ok: true, summary: "Mock session aborted" };
  }

  async progress(args: { run: RunState }): Promise<{ progress: string }> {
    const poll = await this.poll({ run: args.run });
    return { progress: poll.progress ?? poll.summary ?? "no progress" };
  }
}

export function ensureWorktree(
  root: string,
  runId: string,
  workspaceRel: string,
): string {
  const wt = path.join(root, "runs", runId, "worktree");
  if (fs.existsSync(wt)) return path.join(wt, workspaceRel);
  try {
    execFileSync("git", ["worktree", "add", "--detach", wt, "HEAD"], {
      cwd: root,
      stdio: "pipe",
    });
  } catch {
    fs.mkdirSync(wt, { recursive: true });
    const src = path.join(root, workspaceRel);
    const dest = path.join(wt, workspaceRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(src)) {
      copyRecursive(src, dest);
    }
  }
  return path.join(wt, workspaceRel);
}

function copyRecursive(src: string, dest: string): void {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}
