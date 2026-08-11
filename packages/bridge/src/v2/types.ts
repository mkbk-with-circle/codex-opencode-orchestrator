export type ExecutionMode = "strict" | "batch";

export type PlanLifecycle =
  | "draft"
  | "approved"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";

export type PhaseStatus =
  | "pending"
  | "ready"
  | "running"
  | "implemented"
  | "reviewing"
  | "accepted"
  | "blocked"
  | "attempt_failed"
  | "review_failed"
  | "skipped";

export type RunLifecycle =
  | "approved"
  | "running"
  | "paused"
  | "awaiting_final_review"
  | "completed"
  | "failed"
  | "cancelled";

export interface PlanMetadataV2 {
  schemaVersion: 2;
  planId: string;
  task: string;
  workspace: string;
  status: PlanLifecycle;
  executionMode: ExecutionMode;
  batchSize: number;
  approvedAt: string | null;
  specHash: string | null;
}

export interface PhaseReport {
  status: string;
  comment: string;
  evidence: string[];
}

export interface PlanPhaseV2 {
  id: string;
  title: string;
  checked: boolean;
  dependencies: string[];
  allowedPaths: string[];
  acceptance: string[];
  acceptanceCommands: string[];
  report: PhaseReport;
  rawStart: number;
  rawEnd: number;
}

export interface ParsedPlanV2 {
  path: string;
  raw: string;
  metadata: PlanMetadataV2;
  hardRules: string[];
  phases: PlanPhaseV2[];
  globalAcceptanceCommands: string[];
  computedSpecHash: string;
}

export interface PhaseRuntime {
  id: string;
  status: PhaseStatus;
  attempt: number;
  startedAt?: string;
  implementedAt?: string;
  reviewedAt?: string;
  acceptedAt?: string;
  comment?: string;
  evidence: string[];
  executorReportStatus?: string;
  reviewSummary?: string;
  gaps: string[];
  implementedBy?: "opencode" | "codex";
  baselinePaths?: string[];
  baselineHashes?: Record<string, string | null>;
}

export interface ExecutionAuthorityV2 {
  owner: "opencode" | "codex";
  kind: "default" | "temporary" | "persistent";
  phaseId?: string;
  grantedAt?: string;
  expiresAt?: string;
  reason?: string;
}

export interface RunStateV2 {
  schemaVersion: 2;
  id: string;
  planId: string;
  planPath: string;
  planSpecHash: string;
  workspace: string;
  status: RunLifecycle;
  executionMode: ExecutionMode;
  batchSize: number;
  executorId: string;
  executorType: string;
  model?: string;
  sessionId?: string;
  baselineCommit?: string;
  baselineDirtyPaths: string[];
  baselineDirtyHashes: Record<string, string | null>;
  authorizedPhaseIds: string[];
  executionAuthority?: ExecutionAuthorityV2;
  phases: Record<string, PhaseRuntime>;
  nextSeq: number;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt?: string;
  summary?: string;
  error?: string;
}

export type EventType =
  | "run.started"
  | "run.paused"
  | "run.resumed"
  | "run.completed"
  | "run.failed"
  | "run.model_changed"
  | "run.session_replaced"
  | "phase.ready"
  | "phase.started"
  | "phase.implemented"
  | "phase.blocked"
  | "phase.attempt_failed"
  | "review.started"
  | "review.accepted"
  | "review.rework"
  | "review.needs_user"
  | "human.reply_provided"
  | "authority.granted"
  | "authority.returned"
  | "authority.expired"
  | "protocol.violation";

export interface RunEventV2 {
  eventId: string;
  seq: number;
  type: EventType;
  runId: string;
  phaseId?: string;
  attempt?: number;
  at: string;
  payload?: Record<string, unknown>;
}

export interface ReviewVerdict {
  verdict: "accept" | "rework" | "needs_user";
  phaseId: string;
  summary: string;
  evidence?: string[];
  gaps?: string[];
  nextInstruction?: string;
}
