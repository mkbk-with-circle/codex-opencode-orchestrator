---
name: opencode-dispatch
description: >
  把已批准的 v2 Plan 建成 Run，并只把当前 strict/batch 授权窗口派给 OpenCode。
---

# OpenCode Dispatch v2

1. `get_workspace` 必须 bound=true。
2. `validate_plan_v2` 必须通过，Plan 状态必须 approved；draft 先让用户确认并 `approve_plan_v2`。
3. 调用 `start_run_v2`，默认 strict。只有用户明确要求时传 `mode=batch` 和 `batchSize`。
4. 展示 `runId`、workspace、executionMode 和 `authorizedPhaseIds`。
5. 调用 `dispatch_window_v2`。它只能发送授权 Phase，不得使用旧 `dispatch` 发送整份 Plan。
6. OpenCode 只可 `phase_start` / `phase_report`；它的 idle、文字自评和 `[x]` 都不是 Codex 验收。
7. 每个 `phase.implemented` 必须进入 `$opencode-review`；accept 后才派下一窗口。

第一版禁止多个 OpenCode 会话并行写同一 workspace。
