#!/usr/bin/env node
/**
 * CLI for smoke tests without MCP
 */
import {
  dispatch,
  getWorkspaceTool,
  interrupt,
  progress,
  reviewContext,
  rework,
  setWorkspaceTool,
  status,
} from "./orchestrator.js";
import { loadDotEnv } from "./config.js";

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
    case "status":
      console.log(JSON.stringify(await status(flag("--run")), null, 2));
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
    case "progress":
      console.log(
        JSON.stringify(await progress({ runId: flag("--run") }), null, 2),
      );
      break;
    case "review":
      console.log(
        JSON.stringify(await reviewContext(flag("--run")), null, 2),
      );
      break;
    default:
      console.error(
        "用法: cli.ts <dispatch|workspace|set-workspace|status|interrupt|rework|progress|review>",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
