#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  dispatch,
  interrupt,
  progress,
  reviewContext,
  rework,
  status,
} from "./orchestrator.js";
import { loadDotEnv, repoRoot } from "./config.js";

loadDotEnv();

const server = new Server(
  { name: "opencode-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "dispatch",
      description:
        "Create brief from plans/current.md and start executor (mock or OpenCode). If confirm_before_dispatch, returns confirmToken first.",
      inputSchema: {
        type: "object",
        properties: {
          planPath: { type: "string" },
          executorId: { type: "string" },
          confirm: { type: "boolean" },
          confirmedToken: { type: "string" },
          extraInstructions: { type: "string" },
        },
      },
    },
    {
      name: "status",
      description: "Poll active or specified run status, todo, and diff summary.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string" } },
      },
    },
    {
      name: "interrupt",
      description: "Abort the active executor session.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string" } },
      },
    },
    {
      name: "rework",
      description: "Interrupt current run and dispatch again with extra instructions.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          extraInstructions: { type: "string" },
          confirm: { type: "boolean" },
        },
        required: ["extraInstructions"],
      },
    },
    {
      name: "progress",
      description: "Ask executor for a short progress update (or read last progress).",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          prompt: { type: "string" },
        },
      },
    },
    {
      name: "review_context",
      description: "Bundle plan, brief, run state, and acceptance commands for Codex final review.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string" } },
      },
    },
    {
      name: "repo_root",
      description: "Return orchestrator repository root path.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments || {}) as Record<string, unknown>;
  try {
    let result: unknown;
    switch (name) {
      case "dispatch":
        result = await dispatch({
          planPath: args.planPath as string | undefined,
          executorId: args.executorId as string | undefined,
          confirm: args.confirm as boolean | undefined,
          confirmedToken: args.confirmedToken as string | undefined,
          extraInstructions: args.extraInstructions as string | undefined,
        });
        break;
      case "status":
        result = await status(args.runId as string | undefined);
        break;
      case "interrupt":
        result = await interrupt(args.runId as string | undefined);
        break;
      case "rework":
        result = await rework({
          runId: args.runId as string | undefined,
          extraInstructions: String(args.extraInstructions || ""),
          confirm: args.confirm as boolean | undefined,
        });
        break;
      case "progress":
        result = await progress({
          runId: args.runId as string | undefined,
          prompt: args.prompt as string | undefined,
        });
        break;
      case "review_context":
        result = await reviewContext(args.runId as string | undefined);
        break;
      case "repo_root":
        result = { root: repoRoot() };
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: msg }, null, 2) }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
