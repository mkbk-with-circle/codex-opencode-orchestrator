#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  beginUserHoldTool,
  dispatch,
  getWorkspaceTool,
  interrupt,
  listPlansTool,
  listProfilesTool,
  markComplete,
  progress,
  provideUserReplyTool,
  resume,
  reviewContext,
  rework,
  setWorkspaceTool,
  status,
  useProfileTool,
  waitForUserReplyTool,
  writePlanTool,
} from "./orchestrator.js";
import { loadDotEnv, repoRoot } from "./config.js";
import { callV2Tool, isV2Tool, v2ToolDefinitions } from "./v2/api.js";

loadDotEnv();

const server = new Server(
  { name: "opencode-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...v2ToolDefinitions,
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
      description:
        "Poll OpenCode 活动态 + plan phase 勾选。不会把 idle 标成任务完成；completed 只能 mark_complete。",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string" } },
      },
    },
    {
      name: "mark_complete",
      description:
        "【仅 Codex】验收通过后标记任务 completed。OpenCode / poll 不得调用此语义；phase 勾选不等于任务完成。",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          note: { type: "string", description: "验收说明" },
          force: {
            type: "boolean",
            description: "非 awaiting_review 时强制标记",
          },
        },
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
      description:
        "Interrupt and dispatch again（需已绑定）。会杀掉当前会话；OTP/网页登录场景请改用 resume。",
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
      name: "resume",
      description:
        "在同一 OpenCode 会话继续（不 interrupt）。keepAlive 交互等待（OTP/CLI/设备确认等）必须用这个或 provide_user_reply，不要 rework。可选写入 user-reply.md。",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          message: {
            type: "string",
            description: "发给执行器的继续指令",
          },
          userReply: {
            type: "string",
            description: "用户回复原文；会写入业务仓 .orchestrator/user-reply.md 并解锁 wait-reply",
          },
        },
        required: ["message"],
      },
    },
    {
      name: "begin_user_hold",
      description:
        "打开人类门禁（needs-user.md + hold.json + 重置 user-reply）。keepAlive 场景由执行端在保持现场后调用，再 wait_for_user_reply。",
      inputSchema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            description: "otp|credentials|decision|2fa|captcha|device|cli|process|browser|secret|other",
          },
          keepAlive: { type: "boolean" },
          holdHint: {
            type: "string",
            description: "仍保持的现场描述，如 browser IAAA SMS page / ssh sudo prompt",
          },
          question: { type: "string" },
          needWhat: { type: "string" },
          runId: { type: "string" },
        },
      },
    },
    {
      name: "provide_user_reply",
      description:
        "把用户输入写入 .orchestrator/user-reply.md（解锁执行端 wait-reply）。可单独用；常与 resume 一起。",
      inputSchema: {
        type: "object",
        properties: {
          reply: { type: "string" },
          resolveNeedsUser: { type: "boolean" },
        },
        required: ["reply"],
      },
    },
    {
      name: "wait_for_user_reply",
      description:
        "阻塞等待 .orchestrator/user-reply.md（执行端在保持浏览器/CLI/进程现场时调用）。超时默认 900s。",
      inputSchema: {
        type: "object",
        properties: {
          timeoutSec: { type: "number" },
          pollMs: { type: "number" },
        },
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
      name: "list_profiles",
      description:
        "列出可切换的 API/模型 profile，并显示当前 active（config/profiles.yaml）。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "use_profile",
      description:
        "切换当前 OpenCode API/模型 profile（orch use）。同商家换模型或换商家均可。",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "profiles.yaml 中的 profile 名，如 ikuncode-haiku",
          },
        },
        required: ["name"],
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
      case "mark_complete":
        result = await markComplete({
          runId: args.runId as string | undefined,
          note: args.note as string | undefined,
          force: args.force as boolean | undefined,
        });
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
      case "resume":
        result = await resume({
          runId: args.runId as string | undefined,
          message: String(args.message || ""),
          userReply:
            args.userReply !== undefined
              ? String(args.userReply)
              : undefined,
        });
        break;
      case "begin_user_hold":
        result = beginUserHoldTool({
          kind: args.kind as string | undefined,
          keepAlive:
            args.keepAlive === undefined
              ? undefined
              : Boolean(args.keepAlive),
          holdHint: args.holdHint as string | undefined,
          question: args.question as string | undefined,
          needWhat: args.needWhat as string | undefined,
          runId: args.runId as string | undefined,
        });
        break;
      case "provide_user_reply":
        result = provideUserReplyTool({
          reply: String(args.reply || ""),
          resolveNeedsUser:
            args.resolveNeedsUser === undefined
              ? undefined
              : Boolean(args.resolveNeedsUser),
        });
        break;
      case "wait_for_user_reply":
        result = await waitForUserReplyTool({
          timeoutSec:
            args.timeoutSec !== undefined
              ? Number(args.timeoutSec)
              : undefined,
          pollMs:
            args.pollMs !== undefined ? Number(args.pollMs) : undefined,
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
      case "list_profiles":
        result = listProfilesTool();
        break;
      case "use_profile":
        result = await useProfileTool(String(args.name || ""));
        break;
      case "repo_root":
        result = { root: repoRoot() };
        break;
      default:
        if (isV2Tool(name)) result = await callV2Tool(name, args);
        else throw new Error(`Unknown tool: ${name}`);
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
