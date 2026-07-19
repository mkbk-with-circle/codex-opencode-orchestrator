#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  dispatch,
  getWorkspaceTool,
  interrupt,
  listPlansTool,
  progress,
  reviewContext,
  rework,
  setWorkspaceTool,
  status,
  writePlanTool,
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
      name: "get_workspace",
      description:
        "查看是否已绑定业务工作目录、plansDir。未绑定则 bound=false（可调用；其它工具会拒绝）。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "set_workspace",
      description:
        "绑定业务工作目录（唯一入口）。之后 write_plan/dispatch/status/review 强制只在此目录。",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "业务项目绝对路径，如 /Users/me/Projects/MyPet",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "write_plan",
      description:
        "把 plan 写入已绑定业务仓的 .orchestrator/plans/<task>.md（程序强制；未绑定则报错）。会自动写入 workspace frontmatter。",
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "任务名 / 文件名（如 pku-treehole-favorites）",
          },
          content: {
            type: "string",
            description: "Markdown 正文（可含或不含 frontmatter；程序会注入 workspace）",
          },
          overwrite: { type: "boolean" },
        },
        required: ["task", "content"],
      },
    },
    {
      name: "list_plans",
      description: "列出已绑定业务仓 .orchestrator/plans/ 下的 plan。未绑定则报错。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "dispatch",
      description:
        "从已绑定目录的 plan 派工。未绑定则报错；workspace 参数若提供必须等于绑定目录。",
      inputSchema: {
        type: "object",
        properties: {
          planPath: {
            type: "string",
            description: "任务名、相对 plans 文件名，或绑定目录内的绝对路径",
          },
          executorId: { type: "string" },
          confirm: { type: "boolean" },
          confirmedToken: { type: "string" },
          extraInstructions: { type: "string" },
          workspace: {
            type: "string",
            description: "必须与已绑定目录一致；省略则用绑定目录",
          },
        },
      },
    },
    {
      name: "status",
      description: "Poll run status（需已绑定）。",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string" } },
      },
    },
    {
      name: "interrupt",
      description: "Abort active run（需已绑定）。",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string" } },
      },
    },
    {
      name: "rework",
      description: "Interrupt and dispatch again（需已绑定）。",
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
      description: "Ask executor progress（需已绑定）。",
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
      description: "Bundle plan/brief/state for review（需已绑定；plan 须在绑定目录内）。",
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
      case "get_workspace":
        result = await getWorkspaceTool();
        break;
      case "set_workspace":
        result = await setWorkspaceTool(String(args.path || ""));
        break;
      case "write_plan":
        result = await writePlanTool({
          task: String(args.task || ""),
          content: String(args.content || ""),
          overwrite: Boolean(args.overwrite),
        });
        break;
      case "list_plans":
        result = await listPlansTool();
        break;
      case "dispatch":
        result = await dispatch({
          planPath: args.planPath as string | undefined,
          executorId: args.executorId as string | undefined,
          confirm: args.confirm as boolean | undefined,
          confirmedToken: args.confirmedToken as string | undefined,
          extraInstructions: args.extraInstructions as string | undefined,
          workspace: args.workspace as string | undefined,
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
    const code =
      e && typeof e === "object" && "code" in e
        ? String((e as { code?: string }).code || "")
        : "";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { ok: false, error: msg, ...(code ? { code } : {}) },
            null,
            2,
          ),
        },
      ],
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
