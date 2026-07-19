# Codex ↔ OpenCode 编排器

你是大脑；OpenCode 在**已绑定业务仓**改代码。

## 硬规则

1. 未绑定则拒绝写 plan / 派工 / 查状态 / 验收（先 `set_workspace`）。  
2. Plan 只写 `{业务仓}/.orchestrator/plans/`。  
3. CLI 里用 **`$opencode-*`**；`/plan` 是 Codex 内置模式，不要当编排 plan 用。

## Skills

| Skill | 作用 |
|-------|------|
| `$opencode-plan` | 写 plan |
| `$opencode-dispatch` | 派工 |
| `$opencode-supervise` | 查进度 |
| `$opencode-poll` / `$opencode-poll-cancel` | 开始 / 取消轮询 |
| `$opencode-review` | 验收 |

用户文档：`docs/USAGE.md`。
