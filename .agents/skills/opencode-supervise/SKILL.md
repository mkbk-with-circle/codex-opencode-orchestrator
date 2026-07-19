---
name: opencode-supervise
description: >
  Supervise an active run via MCP status/progress/interrupt/rework.
  Requires bound workspace (enforced by bridge). Use for $opencode-supervise.
---

# OpenCode Supervise

先 `get_workspace`：未绑定则只引导 `set_workspace`。

| User intent | Tool |
|-------------|------|
| status | `status` |
| progress | `progress` |
| interrupt | `interrupt` |
| rework | `rework`（要 `extraInstructions`） |

Summarize tool JSON briefly. 所有工具未绑定会直接报错（程序强制）。
