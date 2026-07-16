export type RunStatus =
  | "draft"
  | "awaiting_confirm"
  | "starting"
  | "running"
  | "interrupted"
  | "completed"
  | "failed"
  | "stalled";

export interface OrchestratorConfig {
  confirm_before_dispatch: boolean;
  default_executor: string;
  use_worktree: boolean;
  default_workspace: string;
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

export interface ExecutorsFile {
  executors: Record<string, ExecutorDef>;
}

export interface RunState {
  id: string;
  status: RunStatus;
  executorId: string;
  executorType: string;
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
}

export interface StartResult {
  sessionId?: string;
  summary: string;
}

export interface PollResult {
  status: RunStatus;
  progress?: string;
  summary?: string;
  todo?: unknown;
  diffSummary?: string;
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
  }): Promise<{ progress: string }>;
}
