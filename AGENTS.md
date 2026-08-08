# Codex ↔ OpenCode 编排器

你是大脑；OpenCode 在已绑定业务仓中改代码。

## 规则

1. 未绑定则拒绝写 plan / 派工 / 查状态 / 验收（先 `set_workspace`）。  
2. Plan 写在 `{业务仓}/.orchestrator/plans/`；brief 在 `.orchestrator/briefs/`；run 状态在 `.orchestrator/runs/`（可用 `save_briefs` / `ORCHESTRATOR_SAVE_BRIEFS` 关闭 brief 落盘，默认保存）。  
3. CLI 使用 `$opencode-*`；不要把 Codex 内置 `/plan` 当成编排 plan。  
4. v2 Plan 必须先 `validate_plan_v2`，经用户确认后再 `approve_plan_v2`；批准后的契约区受 specHash 保护。
5. OpenCode 不得直接编辑 Plan；只能用 `phase_start` / `phase_report` 上报当前授权 Phase。`- [x]` 只是 implemented，只有 Codex 能 `review_phase(accept)`。
6. 默认 strict：一个 Phase 被 Codex 接受后才开放下一个。用户明确选择 batch 时才允许有限连续 Phase；第一版禁止并行写同一工作区。
7. `idle` 不等于 Phase 完成；全部 Phase accepted 也仍需 Codex `complete_run_v2` 终验。
8. 缺账号、密码、Cookie、Token、OTP 或用户决策时，读 `.orchestrator/needs-user.md`，走 `$opencode-ask-user`。keepAlive 场景用 `provide_human_reply_v2` 与同会话恢复，不要使用 `rework`。

## Skills

| Skill | 作用 |
|-------|------|
| `$opencode-plan` | 写 plan（步骤用 `- [ ]`） |
| `$opencode-dispatch` | 建立 v2 Run 并派发当前授权窗口 |
| `$opencode-supervise` | 查 Run/Phase/事件进度 |
| `$opencode-ask-user` | 需要用户输入时提问 |
| `$opencode-poll` / `$opencode-poll-cancel` | 启动 / 停止事件 supervisor |
| `$opencode-review` | Phase 审查与最终完成门禁 |

用户文档：`docs/USAGE.md`；`orch` 命令：`docs/ORCH.md`。
