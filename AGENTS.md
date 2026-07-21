# Codex ↔ OpenCode 编排器

你是大脑；OpenCode 在已绑定业务仓中改代码。

## 规则

1. 未绑定则拒绝写 plan / 派工 / 查状态 / 验收（先 `set_workspace`）。  
2. Plan 写在 `{业务仓}/.orchestrator/plans/`；brief 在 `.orchestrator/briefs/`；run 状态在 `.orchestrator/runs/`（可用 `save_briefs` / `ORCHESTRATOR_SAVE_BRIEFS` 关闭 brief 落盘，默认保存）。  
3. CLI 使用 `$opencode-*`；不要把 Codex 内置 `/plan` 当成编排 plan。  
4. OpenCode 只更新 phase `- [x]`；任务 `completed` 只能由你调用 `mark_complete`。idle / `awaiting_review` 不等于完成。  
5. 缺账号、密码、Cookie、Token、OTP 或用户决策时，读 `.orchestrator/needs-user.md`，走 `$opencode-ask-user`。keepAlive 场景用 `provide_user_reply` 与同会话 `resume`，不要使用 `rework`。

## Skills

| Skill | 作用 |
|-------|------|
| `$opencode-plan` | 写 plan（步骤用 `- [ ]`） |
| `$opencode-dispatch` | 派工 |
| `$opencode-supervise` | 查进度 |
| `$opencode-ask-user` | 需要用户输入时提问 |
| `$opencode-poll` / `$opencode-poll-cancel` | 开始 / 取消轮询 |
| `$opencode-review` | 终验；通过后 `mark_complete` |

用户文档：`docs/USAGE.md`；`orch` 命令：`docs/ORCH.md`。
