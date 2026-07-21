#!/usr/bin/env node
/**
 * CLI for smoke tests without MCP
 */
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
import { loadDotEnv } from "./config.js";
import fs from "node:fs";

loadDotEnv();

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const has = (name: string) => rest.includes(name);

  switch (cmd) {
    case "dispatch": {
      const out = await dispatch({
        executorId: flag("--executor"),
        confirm: has("--no-confirm") ? false : has("--confirm") ? true : undefined,
        confirmedToken: flag("--token"),
        extraInstructions: flag("--extra"),
        planPath: flag("--plan"),
        workspace: flag("--workspace"),
      });
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case "workspace":
    case "get-workspace":
      console.log(JSON.stringify(await getWorkspaceTool(), null, 2));
      break;
    case "set-workspace": {
      const p = flag("--path") || rest.find((x) => !x.startsWith("--") && x !== "set-workspace");
      if (!p) {
        console.error("用法: set-workspace --path /绝对路径/到业务项目");
        process.exit(1);
      }
      console.log(JSON.stringify(await setWorkspaceTool(p), null, 2));
      break;
    }
    case "write-plan": {
      const task = flag("--task");
      const file = flag("--file");
      const contentFlag = flag("--content");
      if (!task) {
        console.error("用法: write-plan --task name [--file path.md | --content '...'] [--overwrite]");
        process.exit(1);
      }
      const content = file
        ? fs.readFileSync(file, "utf8")
        : contentFlag || "";
      console.log(
        JSON.stringify(
          await writePlanTool({
            task,
            content,
            overwrite: has("--overwrite"),
          }),
          null,
          2,
        ),
      );
      break;
    }
    case "list-plans":
      console.log(JSON.stringify(await listPlansTool(), null, 2));
      break;
    case "status":
      console.log(JSON.stringify(await status(flag("--run")), null, 2));
      break;
    case "mark-complete":
      console.log(
        JSON.stringify(
          await markComplete({
            runId: flag("--run"),
            note: flag("--note"),
            force: has("--force"),
          }),
          null,
          2,
        ),
      );
      break;
    case "interrupt":
      console.log(JSON.stringify(await interrupt(flag("--run")), null, 2));
      break;
    case "rework":
      console.log(
        JSON.stringify(
          await rework({
            extraInstructions: flag("--extra") || "retry with care",
            confirm: false,
            runId: flag("--run"),
          }),
          null,
          2,
        ),
      );
      break;
    case "resume":
      console.log(
        JSON.stringify(
          await resume({
            runId: flag("--run"),
            message:
              flag("--message") ||
              flag("--extra") ||
              "Continue in the current live scene; do not restart the interaction.",
            userReply: flag("--reply"),
          }),
          null,
          2,
        ),
      );
      break;
    case "begin-hold":
    case "begin-user-hold":
      console.log(
        JSON.stringify(
          beginUserHoldTool({
            kind: flag("--kind"),
            keepAlive: has("--no-keepalive") ? false : undefined,
            holdHint: flag("--hint"),
            question: flag("--question"),
            needWhat: flag("--need"),
            runId: flag("--run"),
          }),
          null,
          2,
        ),
      );
      break;
    case "provide-reply":
    case "provide-user-reply":
      {
        const reply = flag("--reply") || flag("--text");
        if (!reply) {
          console.error("用法: provide-reply --reply '用户输入'");
          process.exit(1);
        }
        console.log(
          JSON.stringify(provideUserReplyTool({ reply }), null, 2),
        );
      }
      break;
    case "wait-reply":
    case "wait-for-user-reply":
      {
        const timeoutSec = flag("--timeout")
          ? Number(flag("--timeout"))
          : undefined;
        const out = await waitForUserReplyTool({ timeoutSec });
        console.log(JSON.stringify(out, null, 2));
        if (!out.ok) process.exit(2);
      }
      break;
    case "progress":
      console.log(
        JSON.stringify(
          await progress({
            runId: flag("--run"),
            prompt: flag("--prompt") || flag("--message"),
          }),
          null,
          2,
        ),
      );
      break;
    case "review":
      console.log(
        JSON.stringify(await reviewContext(flag("--run")), null, 2),
      );
      break;
    case "use":
    case "use-profile": {
      const name =
        flag("--profile") ||
        rest.find((x) => !x.startsWith("--") && x !== "use" && x !== "use-profile");
      if (!name || has("--list") || name === "list") {
        console.log(JSON.stringify(listProfilesTool(), null, 2));
        break;
      }
      console.log(JSON.stringify(await useProfileTool(name), null, 2));
      break;
    }
    case "profiles":
    case "list-profiles":
      console.log(JSON.stringify(listProfilesTool(), null, 2));
      break;
    default:
      console.error(
        "用法: cli.ts <dispatch|workspace|…|use|profiles|wait-reply|…>",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
