---
name: opencode-supervise
description: >
  监督 v2 Run、Phase、OpenCode heartbeat 和事件；处理暂停、重试、取消与人工门禁。
---

# OpenCode Supervise v2

1. `get_workspace` 必须 bound=true，然后调用 `status_v2`。
2. 若 hold open，立即走 `$opencode-ask-user`；不要派工、重试或完成 Run。
3. `poll_executor_v2` 只表示活动/心跳。OpenCode idle 不表示 implemented 或 accepted。
4. `phase.implemented` → `$opencode-review`。
5. `phase.attempt_failed` / `review_failed` → Codex 分析缺口；可修复时 `retry_phase`，再 `dispatch_window_v2`。
6. `phase.blocked` → 问用户；收到回答后 `provide_human_reply_v2`，保持同一 OpenCode 现场。
7. 用户要求暂停/恢复/取消时使用 `pause_run_v2` / `resume_run_v2` / `cancel_run_v2`。
8. executor 持续卡死且没有 open hold 时，可用 `replace_run_session_v2` 保留 Run/Phase/文件状态并更换会话；有 keepAlive 现场时禁止更换。
9. 不得依赖“最近一次 run”处理多个 Run；已知时始终显式传 runId。
10. 检查 executionAuthority。Codex 无有效用户授权时只可监督和验收，不得直接实施；Codex 永远不得自行调用授权或延长授权。
