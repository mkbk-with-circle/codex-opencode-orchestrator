import {
  acknowledgeSupervisorEventV2,
  approvePlanV2Tool,
  completeRunV2,
  dispatchWindowV2,
  cancelRunV2,
  listRunsV2,
  migratePlanV2Tool,
  pendingSupervisorEventsV2,
  pauseRunV2,
  phaseReportV2,
  phaseStartV2,
  pollExecutorV2,
  provideHumanReplyV2,
  replaceRunSessionV2,
  retryPhaseV2,
  resumeRunV2,
  reviewContextV2,
  reviewPhaseV2,
  startRunV2,
  statusV2,
  switchRunModelV2,
  runPhaseAcceptanceV2,
  validatePlanV2Tool,
} from "./service.js";
import { checkOpenCodeProfile, configureOpenCodeProfile } from "../profiles.js";

export const v2ToolDefinitions = [
  {
    name: "configure_opencode_profile",
    description: "Register an OpenCode provider/model/profile quickly. Stores only an API-key environment-variable reference, never the secret value.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        model: { type: "string", description: "providerId/modelId" },
        baseUrl: { type: "string" },
        apiKeyEnv: { type: "string" },
        npm: { type: "string" },
        note: { type: "string" },
        activate: { type: "boolean" },
      },
      required: ["name", "model"],
    },
  },
  {
    name: "check_opencode_profile",
    description: "Check whether an OpenCode profile's provider/model and referenced API-key environment variable are configured.",
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
  },
  {
    name: "migrate_plan_v2",
    description: "Convert a v1 Plan to a reviewable v2 draft. Defaults to a new .v2.md file; in-place mode creates a timestamped backup first.",
    inputSchema: {
      type: "object",
      properties: {
        planPath: { type: "string" },
        outputPath: { type: "string" },
        inPlace: { type: "boolean" },
      },
    },
  },
  {
    name: "validate_plan_v2",
    description: "Validate a v2 Plan contract without changing it.",
    inputSchema: { type: "object", properties: { planPath: { type: "string" } } },
  },
  {
    name: "approve_plan_v2",
    description: "Codex-only: freeze a validated Plan and persist its integrity hash.",
    inputSchema: { type: "object", properties: { planPath: { type: "string" } } },
  },
  {
    name: "start_run_v2",
    description: "Codex-only: create a v2 Run and authorize its first strict/batch phase window; does not contact OpenCode yet.",
    inputSchema: {
      type: "object",
      properties: {
        planPath: { type: "string" },
        executorId: { type: "string" },
        mode: { type: "string", enum: ["strict", "batch"] },
        batchSize: { type: "number" },
      },
    },
  },
  {
    name: "switch_run_model_v2",
    description: "Codex/user control: switch the OpenCode profile/model for an active Run while preserving its session.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" }, executorId: { type: "string" } },
      required: ["executorId"],
    },
  },
  {
    name: "replace_run_session_v2",
    description: "Codex/user recovery: abort a stalled executor session and create a replacement while preserving Run/Phase/file state. Refused while a human hold is open.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" }, reason: { type: "string" } },
    },
  },
  {
    name: "dispatch_window_v2",
    description: "Codex-only: send only the current authorized phase window to OpenCode, reusing its session when possible.",
    inputSchema: { type: "object", properties: { runId: { type: "string" } } },
  },
  {
    name: "phase_start",
    description: "Executor report API: mark one currently authorized phase running before edits.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" }, phaseId: { type: "string" }, workspace: { type: "string" } },
      required: ["phaseId"],
    },
  },
  {
    name: "phase_report",
    description: "Executor report API: report complete, failed, or blocked for the running authorized phase. This cannot accept a phase or complete the run.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        workspace: { type: "string" },
        phaseId: { type: "string" },
        outcome: { type: "string", enum: ["complete", "failed", "blocked"] },
        comment: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
        needUser: { type: "string" },
        keepAlive: { type: "boolean" },
        holdKind: { type: "string", enum: ["otp", "credentials", "decision", "2fa", "captcha", "device", "cli", "process", "browser", "secret", "other"] },
      },
      required: ["phaseId", "outcome"],
    },
  },
  {
    name: "review_context_v2",
    description: "Codex-only: load the frozen contract, phase report, current diff, and evidence for independent phase review.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" }, phaseId: { type: "string" } },
    },
  },
  {
    name: "review_phase",
    description: "Codex-only: accept, reject for rework, or request human input for one implemented phase.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        verdict: { type: "string", enum: ["accept", "rework", "needs_user"] },
        phaseId: { type: "string" },
        summary: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
        nextInstruction: { type: "string" },
      },
      required: ["verdict", "phaseId", "summary"],
    },
  },
  {
    name: "retry_phase",
    description: "Codex-only: reopen one blocked/failed/review-failed phase after its blocker is resolved.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" }, phaseId: { type: "string" } },
      required: ["phaseId"],
    },
  },
  {
    name: "status_v2",
    description: "Read v2 Run, Plan integrity, Phase states, and recent events.",
    inputSchema: { type: "object", properties: { runId: { type: "string" } } },
  },
  {
    name: "poll_executor_v2",
    description: "Read OpenCode activity as a heartbeat only; idle never means phase acceptance or run completion.",
    inputSchema: { type: "object", properties: { runId: { type: "string" } } },
  },
  {
    name: "run_phase_acceptance_v2",
    description: "Run the frozen phase acceptance commands and persist their outputs as review evidence.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" }, phaseId: { type: "string" } },
      required: ["phaseId"],
    },
  },
  {
    name: "pause_run_v2",
    description: "Codex/user control: pause scheduling and clear the authorized phase window.",
    inputSchema: { type: "object", properties: { runId: { type: "string" }, reason: { type: "string" } } },
  },
  {
    name: "resume_run_v2",
    description: "Codex/user control: resume a paused run only when no human hold remains open.",
    inputSchema: { type: "object", properties: { runId: { type: "string" } } },
  },
  {
    name: "cancel_run_v2",
    description: "Codex/user control: abort the OpenCode session when present and cancel the run.",
    inputSchema: { type: "object", properties: { runId: { type: "string" }, reason: { type: "string" } } },
  },
  {
    name: "provide_human_reply_v2",
    description: "Deliver a human answer to the exact held run/phase/attempt and reopen that phase.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" }, reply: { type: "string" } },
      required: ["reply"],
    },
  },
  {
    name: "complete_run_v2",
    description: "Codex-only: complete a Run only when every phase is accepted, Plan integrity holds, and no human hold is open.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" }, note: { type: "string" } },
    },
  },
  {
    name: "pending_events_v2",
    description: "Return actionable events after the durable supervisor cursor.",
    inputSchema: { type: "object", properties: { runId: { type: "string" } } },
  },
  {
    name: "ack_event_v2",
    description: "Advance the durable supervisor cursor after an event was handled successfully.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" }, seq: { type: "number" } },
      required: ["seq"],
    },
  },
  {
    name: "list_runs_v2",
    description: "List v2 Runs in the bound workspace.",
    inputSchema: { type: "object", properties: {} },
  },
];

export function isV2Tool(name: string): boolean {
  return v2ToolDefinitions.some((tool) => tool.name === name);
}

export async function callV2Tool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "configure_opencode_profile":
      return configureOpenCodeProfile({
        name: String(args.name || ""),
        model: String(args.model || ""),
        baseUrl: args.baseUrl as string | undefined,
        apiKeyEnv: args.apiKeyEnv as string | undefined,
        npm: args.npm as string | undefined,
        note: args.note as string | undefined,
        activate: Boolean(args.activate),
      });
    case "check_opencode_profile":
      return checkOpenCodeProfile(args.name as string | undefined);
    case "validate_plan_v2":
      return validatePlanV2Tool({ planPath: args.planPath as string | undefined });
    case "migrate_plan_v2":
      return migratePlanV2Tool({
        planPath: args.planPath as string | undefined,
        outputPath: args.outputPath as string | undefined,
        inPlace: Boolean(args.inPlace),
      });
    case "approve_plan_v2":
      return approvePlanV2Tool({ planPath: args.planPath as string | undefined });
    case "start_run_v2":
      return startRunV2({
        planPath: args.planPath as string | undefined,
        executorId: args.executorId as string | undefined,
        mode: args.mode as "strict" | "batch" | undefined,
        batchSize: args.batchSize === undefined ? undefined : Number(args.batchSize),
      });
    case "dispatch_window_v2":
      return dispatchWindowV2({ runId: args.runId as string | undefined });
    case "switch_run_model_v2":
      return switchRunModelV2({ runId: args.runId as string | undefined, executorId: String(args.executorId || "") });
    case "replace_run_session_v2":
      return replaceRunSessionV2({ runId: args.runId as string | undefined, reason: args.reason as string | undefined });
    case "phase_start":
      return phaseStartV2({ runId: args.runId as string | undefined, phaseId: String(args.phaseId || ""), workspace: args.workspace as string | undefined });
    case "phase_report":
      return phaseReportV2({
        runId: args.runId as string | undefined,
        workspace: args.workspace as string | undefined,
        phaseId: String(args.phaseId || ""),
        outcome: args.outcome as "complete" | "failed" | "blocked",
        comment: args.comment as string | undefined,
        evidence: args.evidence as string[] | undefined,
        needUser: args.needUser as string | undefined,
        keepAlive: args.keepAlive as boolean | undefined,
        holdKind: args.holdKind as string | undefined,
      });
    case "review_context_v2":
      return reviewContextV2({ runId: args.runId as string | undefined, phaseId: args.phaseId as string | undefined });
    case "review_phase":
      return reviewPhaseV2({
        runId: args.runId as string | undefined,
        verdict: {
          verdict: args.verdict as "accept" | "rework" | "needs_user",
          phaseId: String(args.phaseId || ""),
          summary: String(args.summary || ""),
          evidence: args.evidence as string[] | undefined,
          gaps: args.gaps as string[] | undefined,
          nextInstruction: args.nextInstruction as string | undefined,
        },
      });
    case "retry_phase":
      return retryPhaseV2({ runId: args.runId as string | undefined, phaseId: String(args.phaseId || "") });
    case "status_v2":
      return statusV2({ runId: args.runId as string | undefined });
    case "poll_executor_v2":
      return pollExecutorV2({ runId: args.runId as string | undefined });
    case "run_phase_acceptance_v2":
      return runPhaseAcceptanceV2({ runId: args.runId as string | undefined, phaseId: String(args.phaseId || "") });
    case "pause_run_v2":
      return pauseRunV2({ runId: args.runId as string | undefined, reason: args.reason as string | undefined });
    case "resume_run_v2":
      return resumeRunV2({ runId: args.runId as string | undefined });
    case "cancel_run_v2":
      return cancelRunV2({ runId: args.runId as string | undefined, reason: args.reason as string | undefined });
    case "provide_human_reply_v2":
      return provideHumanReplyV2({ runId: args.runId as string | undefined, reply: String(args.reply || "") });
    case "complete_run_v2":
      return completeRunV2({ runId: args.runId as string | undefined, note: args.note as string | undefined });
    case "pending_events_v2":
      return pendingSupervisorEventsV2({ runId: args.runId as string | undefined });
    case "ack_event_v2":
      return acknowledgeSupervisorEventV2({ runId: args.runId as string | undefined, seq: Number(args.seq) });
    case "list_runs_v2":
      return listRunsV2();
    default:
      throw new Error(`unknown_v2_tool: ${name}`);
  }
}
