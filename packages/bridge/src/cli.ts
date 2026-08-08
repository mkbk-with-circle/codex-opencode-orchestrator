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
import {
  acknowledgeSupervisorEventV2,
  approvePlanV2Tool,
  cancelRunV2,
  completeRunV2,
  dispatchWindowV2,
  listRunsV2,
  migratePlanV2Tool,
  pendingSupervisorEventsV2,
  pauseRunV2,
  phaseReportV2,
  phaseStartV2,
  pollExecutorV2,
  provideHumanReplyV2,
  retryPhaseV2,
  replaceRunSessionV2,
  resumeRunV2,
  runPhaseAcceptanceV2,
  reviewContextV2,
  reviewPhaseV2,
  startRunV2,
  statusV2,
  switchRunModelV2,
  validatePlanV2Tool,
} from "./v2/service.js";
import { checkOpenCodeProfile, configureOpenCodeProfile } from "./profiles.js";

loadDotEnv();

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const has = (name: string) => rest.includes(name);
  const listFlag = (name: string) =>
    (flag(name) || "").split("|").map((value) => value.trim()).filter(Boolean);

  switch (cmd) {
    case "model-add":
      console.log(JSON.stringify(configureOpenCodeProfile({
        name: flag("--name") || "",
        model: flag("--model") || "",
        baseUrl: flag("--base-url"),
        apiKeyEnv: flag("--api-key-env"),
        npm: flag("--npm"),
        note: flag("--note"),
        activate: has("--activate"),
      }), null, 2));
      break;
    case "model-check":
      console.log(JSON.stringify(checkOpenCodeProfile(flag("--name") || rest.find((x) => !x.startsWith("--"))), null, 2));
      break;
    case "plan-validate":
      console.log(JSON.stringify(validatePlanV2Tool({ planPath: flag("--plan") }), null, 2));
      break;
    case "plan-migrate":
      console.log(JSON.stringify(migratePlanV2Tool({
        planPath: flag("--plan"),
        outputPath: flag("--output"),
        inPlace: has("--in-place"),
      }), null, 2));
      break;
    case "plan-approve":
      console.log(JSON.stringify(approvePlanV2Tool({ planPath: flag("--plan") }), null, 2));
      break;
    case "run-start":
      console.log(JSON.stringify(startRunV2({
        planPath: flag("--plan"),
        executorId: flag("--executor"),
        mode: flag("--mode") as "strict" | "batch" | undefined,
        batchSize: flag("--batch-size") ? Number(flag("--batch-size")) : undefined,
      }), null, 2));
      break;
    case "run-dispatch":
      console.log(JSON.stringify(await dispatchWindowV2({ runId: flag("--run") }), null, 2));
      break;
    case "run-model":
      console.log(JSON.stringify(switchRunModelV2({
        runId: flag("--run"),
        executorId: flag("--executor") || flag("--profile") || "",
      }), null, 2));
      break;
    case "run-replace-session":
      console.log(JSON.stringify(await replaceRunSessionV2({
        runId: flag("--run"),
        reason: flag("--reason"),
      }), null, 2));
      break;
    case "run-status":
      console.log(JSON.stringify(statusV2({ runId: flag("--run") }), null, 2));
      break;
    case "run-list":
      console.log(JSON.stringify(listRunsV2(), null, 2));
      break;
    case "run-poll":
      console.log(JSON.stringify(await pollExecutorV2({ runId: flag("--run") }), null, 2));
      break;
    case "run-complete":
      console.log(JSON.stringify(completeRunV2({ runId: flag("--run"), note: flag("--note") }), null, 2));
      break;
    case "run-pause":
      console.log(JSON.stringify(pauseRunV2({ runId: flag("--run"), reason: flag("--reason") }), null, 2));
      break;
    case "run-resume":
      console.log(JSON.stringify(resumeRunV2({ runId: flag("--run") }), null, 2));
      break;
    case "run-cancel":
      console.log(JSON.stringify(await cancelRunV2({ runId: flag("--run"), reason: flag("--reason") }), null, 2));
      break;
    case "phase-start":
      console.log(JSON.stringify(phaseStartV2({
        runId: flag("--run"),
        phaseId: flag("--phase") || "",
      }), null, 2));
      break;
    case "phase-report":
      console.log(JSON.stringify(phaseReportV2({
        runId: flag("--run"),
        phaseId: flag("--phase") || "",
        outcome: (flag("--outcome") || "complete") as "complete" | "failed" | "blocked",
        comment: flag("--comment"),
        evidence: listFlag("--evidence"),
        needUser: flag("--need-user"),
        keepAlive: has("--keep-alive"),
        holdKind: flag("--hold-kind"),
      }), null, 2));
      break;
    case "phase-review":
      console.log(JSON.stringify(reviewPhaseV2({
        runId: flag("--run"),
        verdict: {
          verdict: (flag("--verdict") || "accept") as "accept" | "rework" | "needs_user",
          phaseId: flag("--phase") || "",
          summary: flag("--summary") || "",
          evidence: listFlag("--evidence"),
          gaps: listFlag("--gaps"),
          nextInstruction: flag("--next"),
        },
      }), null, 2));
      break;
    case "phase-retry":
      console.log(JSON.stringify(retryPhaseV2({
        runId: flag("--run"),
        phaseId: flag("--phase") || "",
      }), null, 2));
      break;
    case "phase-acceptance":
      console.log(JSON.stringify(runPhaseAcceptanceV2({
        runId: flag("--run"),
        phaseId: flag("--phase") || "",
      }), null, 2));
      break;
    case "human-reply-v2":
      {
      const reply = has("--stdin") ? fs.readFileSync(0, "utf8").replace(/[\r\n]+$/, "") : flag("--reply") || "";
      if (!reply) throw new Error("human_reply_empty");
      console.log(JSON.stringify(provideHumanReplyV2({
        runId: flag("--run"),
        reply,
      }), null, 2));
      break;
      }
    case "review-context-v2":
      console.log(JSON.stringify(reviewContextV2({
        runId: flag("--run"),
        phaseId: flag("--phase"),
      }), null, 2));
      break;
    case "events-pending":
      console.log(JSON.stringify(pendingSupervisorEventsV2({ runId: flag("--run") }), null, 2));
      break;
    case "events-ack":
      console.log(JSON.stringify(acknowledgeSupervisorEventV2({
        runId: flag("--run"),
        seq: Number(flag("--seq")),
      }), null, 2));
      break;
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
        "用法: cli.ts <plan-validate|plan-approve|run-start|run-dispatch|run-status|phase-start|phase-report|phase-review|…>",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
