---
name: opencode-review
description: >
  Codex 对 implemented Phase 做独立验收，并在全部 Phase accepted 后执行最终完成门禁。
---

# OpenCode Review v2

## Phase 审查

1. 调用 `review_context_v2`，锁定 exact runId + phaseId + attempt。
2. 读取冻结契约、OpenCode 报告、证据快照、captured diff 和当前 diff。
3. 必须自己检查文件；存在验收命令时调用 `run_phase_acceptance_v2`。
4. 给出结构化结论：
   - `accept`：要求已满足，调用 `review_phase`；若出现新授权窗口，再 `dispatch_window_v2`。
   - `rework`：列清 gaps 和 nextInstruction，调用 `review_phase`，随后按需 `retry_phase`。
   - `needs_user`：调用 `review_phase` 打开人工门禁并停止。
5. 审查失败时控制面会取消 Phase 勾选并保留 attempt 历史。

## 最终验收

只有全部 Phase accepted、Plan 完整性有效、无 open hold 时才能调用 `complete_run_v2`。该工具还会运行 Plan 的总体验收命令；任一失败都不得 completed。
