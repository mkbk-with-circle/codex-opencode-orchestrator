#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { loadDotEnv } from "./config.js";
import { phaseReportV2, phaseStartV2 } from "./v2/service.js";
import { waitForUserReply } from "./user-hold.js";
import { requireBoundWorkspace } from "./workspace.js";

loadDotEnv();

const tools = [
  {
    name: "phase_start",
    description: "Start exactly one phase authorized by Codex. Call this before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        runId: { type: "string" },
        phaseId: { type: "string" },
      },
      required: ["workspace", "runId", "phaseId"],
    },
  },
  {
    name: "phase_report",
    description: "Report one authorized phase as complete, failed, or blocked. This cannot approve a phase or complete a run.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        runId: { type: "string" },
        phaseId: { type: "string" },
        outcome: { type: "string", enum: ["complete", "failed", "blocked"] },
        comment: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
        needUser: { type: "string" },
        keepAlive: { type: "boolean" },
        holdKind: { type: "string" },
      },
      required: ["workspace", "runId", "phaseId", "outcome"],
    },
  },
  {
    name: "wait_for_human_reply",
    description: "Wait inside the same live OpenCode attempt for a human reply. For credentials/OTP/2FA/secret holds, the result contains only a 0600 handoff file path: never read or print it; pass the path to the authorized program, which must consume and delete it.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        timeoutSec: { type: "number" },
      },
      required: ["workspace"],
    },
  },
] as const;

const server = new Server(
  { name: "orchestrator-reporter", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments || {}) as Record<string, unknown>;
  try {
    const requestedWorkspace = String(args.workspace || "");
    if (!path.isAbsolute(requestedWorkspace)) throw new Error("workspace_must_be_absolute");
    const boundWorkspace = requireBoundWorkspace().absPath;
    if (path.resolve(requestedWorkspace) !== path.resolve(boundWorkspace)) {
      throw new Error(`executor_workspace_not_bound: ${requestedWorkspace}`);
    }
    let result: unknown;
    if (request.params.name === "phase_start") {
      result = phaseStartV2({
        workspace: requestedWorkspace,
        runId: String(args.runId || ""),
        phaseId: String(args.phaseId || ""),
      });
    } else if (request.params.name === "phase_report") {
      result = phaseReportV2({
        workspace: requestedWorkspace,
        runId: String(args.runId || ""),
        phaseId: String(args.phaseId || ""),
        outcome: args.outcome as "complete" | "failed" | "blocked",
        comment: args.comment as string | undefined,
        evidence: args.evidence as string[] | undefined,
        needUser: args.needUser as string | undefined,
        keepAlive: args.keepAlive as boolean | undefined,
        holdKind: args.holdKind as string | undefined,
      });
    } else if (request.params.name === "wait_for_human_reply") {
      result = await waitForUserReply(requestedWorkspace, {
        timeoutMs: Math.max(1, Number(args.timeoutSec || 900)) * 1000,
        exposeSensitive: false,
      });
    } else {
      throw new Error(`unknown_executor_tool: ${request.params.name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    };
  }
});

await server.connect(new StdioServerTransport());
