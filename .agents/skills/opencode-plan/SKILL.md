---
name: opencode-plan
description: >
  与用户澄清需求并在已绑定业务仓生成 v2 多阶段 Plan。Plan 先保持 draft，
  validate_plan_v2 通过且用户明确确认后才 approve_plan_v2。
---

# OpenCode Plan v2

1. 调用 `get_workspace`；未绑定时只做 `set_workspace`，不得猜目录。
2. 与用户确认目标、范围、非范围、执行模式和整个项目必须遵守的硬性规定。
3. 用 `write_plan` 写入 `{workspace}/.orchestrator/plans/<task>.md`，状态必须是 `draft`。
4. 每个 Phase 必须：
   - 使用唯一、稳定 ID：`- [ ] P01 — 标题`。
   - 声明早于自己的依赖、允许修改路径、验收标准，能自动化时声明验收命令。
   - 包含 `OPENCODE REPORT Pxx START/END` 受控报告区。
5. 默认 `executionMode: strict`、`batchSize: 1`。只有用户明确选择 batch 才改变。
6. 调用 `validate_plan_v2`。展示错误、警告、Plan 路径和 Phase 摘要，请用户检查。
7. 用户明确确认后才调用 `approve_plan_v2`；批准会冻结契约并生成 specHash。
8. 不要在写完 Plan 后自动派工。

OpenCode 不得直接改 Plan；运行后通过 `phase_start` / `phase_report` 让控制面更新勾选和报告。
