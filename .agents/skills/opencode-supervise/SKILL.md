---
name: opencode-supervise
description: >
  Supervise an active OpenCode/mock run via MCP: status, progress, interrupt, rework.
  Use for /status /progress /interrupt /rework or when the user asks how the executor is doing.
---

# OpenCode Supervise

Use MCP `opencode-bridge` tools:

| User intent | Tool | Args |
|-------------|------|------|
| `/status` / how is it going | `status` | optional `runId` |
| `/progress` | `progress` | optional custom `prompt` |
| `/interrupt` / stop | `interrupt` | optional `runId` |
| `/rework` / redo with changes | `rework` | **required** `extraInstructions`; prefer `confirm: false` after user already approved direction |

## Rules

- Summarize tool JSON in short human language (5–10 lines).
- After interrupt, wait for user before rework unless they gave new instructions in the same message.
- If status is `failed`/`stalled`, surface `error` and suggest rework or switching to `mock` for control-plane debug.
