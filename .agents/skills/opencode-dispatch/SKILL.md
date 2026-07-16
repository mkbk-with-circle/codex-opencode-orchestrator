---
name: opencode-dispatch
description: >
  Dispatch a finalized plan (plans/current.md) to OpenCode/mock via MCP opencode-bridge.
  Use when the user says /dispatch, asks to start execution, or invoke $opencode-dispatch.
---

# OpenCode Dispatch

You are preparing work for an **executor** (OpenCode or mock). You stay the reviewer/brain.

## Steps

1. Ensure `plans/current.md` exists and matches what the user agreed.
2. Call MCP tool `dispatch` from server `opencode-bridge`.
   - First call usually returns `needsConfirm: true` + `confirmToken` + `briefPreview`.
3. Show the brief to the user and ask for confirmation (unless they already said "skip confirm" / config has confirm off).
4. On confirm, call `dispatch` again with the same `confirmedToken`.
5. Report `runId`, `status`, `sessionId`, and `worktreePath`.

## Notes

- Prefer executor from config; override with `executorId` only if user asks (`mock` vs `siliconflow-opencode`).
- Do not start coding yourself unless the user explicitly asks you to implement instead of dispatching.
