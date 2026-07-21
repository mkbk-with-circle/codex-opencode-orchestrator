export type RunStatus =
  | "draft"
  | "awaiting_confirm"
  | "starting"
  | "running"
  /** OpenCode 已停手（idle）；phase 勾选可供查看，但任务是否完成只能由 Codex mark_complete */
  | "awaiting_review"
  | "interrupted"
  | "completed"
  | "failed"
  | "stalled";

/** OpenCode 侧活动态：绝不等于「任务完成」 */
export type ExecutorActivity = "busy" | "idle" | "stalled" | "failed" | "interrupted";

export interface OrchestratorConfig {
  confirm_before_dispatch: boolean;
  default_executor: string;
  use_worktree: boolean;
  default_workspace: string;
  /**
   * Persist each dispatch brief under `{业务仓}/.orchestrator/briefs/`.
   * Default true. Override with env ORCHESTRATOR_SAVE_BRIEFS=0|false|no|off.
   */
  save_briefs?: boolean;
  gates: { require_confirm: string[] };
  acceptance: { commands: string[] };
  ssh_remote?: {
    enabled: boolean;
    host: string;
    note?: string;
  };
}

export interface ExecutorDef {
  type: "mock" | "opencode-http";
  description?: string;
  options: Record<string, unknown>;
}

export interface RunState {
  id: string;
  status: RunStatus;
  executorId: string;
  executorType: string;
  /** Current OpenCode model id provider/model (for same-API switches) */
  model?: string;
  planPath: string;
  briefPath: string;
  workspace: string;
  worktreePath?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  lastProgress?: string;
  error?: string;
  summary?: string;
  confirmToken?: string;
  /** OpenCode: prompt 已发出的时间 */
  promptSentAt?: string;
  /** OpenCode: 是否曾经进入 busy（避免把「刚启动的 idle」误判为完成） */
  seenBusy?: boolean;
}

export interface StartResult {
  sessionId?: string;
  summary: string;
}

export interface PollResult {
  /** 执行器活动态；编排层会映射到 RunStatus，但不会映射成 completed */
  activity: ExecutorActivity;
  /**
   * 派生的 run 状态建议（不含 completed）。
   * completed 只能由 Codex 调用 mark_complete。
   */
  status: Exclude<RunStatus, "completed" | "draft" | "awaiting_confirm">;
  progress?: string;
  summary?: string;
  todo?: unknown;
  diffSummary?: string;
  seenBusy?: boolean;
}

export interface ExecutorAdapter {
  readonly type: string;
  start(args: {
    run: RunState;
    brief: string;
    workspace: string;
    options: Record<string, unknown>;
  }): Promise<StartResult>;
  poll(args: {
    run: RunState;
    options: Record<string, unknown>;
  }): Promise<PollResult>;
  abort(args: {
    run: RunState;
    options: Record<string, unknown>;
  }): Promise<{ ok: boolean; summary: string }>;
  progress(args: {
    run: RunState;
    options: Record<string, unknown>;
    prompt?: string;
    /** Override model for this turn (same-session switch) */
    model?: string;
  }): Promise<{ progress: string }>;
}
