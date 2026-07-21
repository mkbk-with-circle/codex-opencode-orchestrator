---
name: opencode-supervise
description: >
  Supervise an active run via MCP status/progress/interrupt/rework.
  Requires bound workspace (enforced by bridge). Use for $opencode-supervise.
  OpenCode only owns phase checkboxes; Codex owns final completion.
  If needs-user is open, stop and ask the human first.
---

# OpenCode Supervise

先 `get_workspace`：未绑定则只引导 `set_workspace`。

## 优先：人类门禁

若 `{绑定仓}/.orchestrator/needs-user.md` 存在且 `status: open`：

→ **立刻**按 `$opencode-ask-user` 处理：停止推进，只向用户提问。  
不要 status 空转、不要 rework、不要 mark_complete。  
用户给出验证码/选项后：用 **`provide_user_reply`**（+ 必要时 **`resume`**），**禁止** `rework`。

| User intent | Tool |
|-------------|------|
| status | `status`（含 `phases` 勾选统计） |
| 投喂用户输入（keepAlive） | `provide_user_reply` → 可选 `resume` |
| progress | `progress` |
| interrupt | `interrupt` |
| rework | `rework`（会杀会话；keepAlive 场景禁用） |

## 完成权

- **OpenCode**：只能把 plan 里各 phase 从 `- [ ]` 改成 `- [x]`。  
- **Codex**：判断整体任务是否达标；通过后调用 `mark_complete`。  
- `status=awaiting_review` / OpenCode idle **≠** 任务完成。  
- `status=completed` **只**能来自 Codex 的 `mark_complete`。

## 读进度

1. `status` → 看 `run.status`、`poll.activity`、`phases`  
2. 打开 plan，核对 `## 步骤` 下 `- [x]` / `- [ ]`  
3. 向用户列出：已完成 / 未完成步骤原文  

若 `awaiting_review`：继续 `$opencode-review`，PASS 后 `mark_complete`；FAIL 则 `rework`。

Summarize briefly. 未绑定会直接报错（程序强制）。
