#!/usr/bin/env node
/**
 * CLI for smoke tests without MCP (used by scripts/smoke-dispatch.sh)
 */
import {
  dispatch,
  interrupt,
  progress,
  reviewContext,
  rework,
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
      });
      console.log(JSON.stringify(out, null, 2));
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
        "Usage: cli.ts <dispatch|status|interrupt|rework|progress|review> [...flags]",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
