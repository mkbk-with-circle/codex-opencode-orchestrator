---
name: opencode-review
description: >
  Final verification that an executor run satisfies plans/current.md. Use for /review
  or when the user asks whether the OpenCode work is done correctly.
---

# OpenCode Review

1. Call MCP `review_context` to load plan, brief, run state, and acceptance commands.
2. Inspect the actual workspace / worktree diff yourself (read files; do not trust executor self-report).
3. Run acceptance commands from the context (shell), plus any extra checks the plan lists.
4. Gate reminders: destructive shell and mass deletes needed user confirmation — flag if executor violated scope.
5. Output a clear verdict:

```
VERDICT: PASS | FAIL
Evidence:
- ...
Gaps / next:
- ...
```

Only say PASS if the original plan acceptance criteria are met.
