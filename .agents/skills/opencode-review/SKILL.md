---
name: opencode-review
description: >
  Final verification via review_context; Codex decides PASS/FAIL and may mark_complete.
  Requires bound workspace (enforced). Use for $opencode-review.
---

# OpenCode Review（Codex 终验）

OpenCode 的 phase 勾选只是进度信号，**不能**当作任务完成。

1. `get_workspace`：未绑定则先 `set_workspace`。  
2. MCP `review_context` / `status` 加载 plan、brief、run、`phases`。  
3. 在**绑定业务仓**里读文件、跑验收命令；不信任执行器自评。  
4. 输出：

```
VERDICT: PASS | FAIL
Evidence:
- ...
Gaps / next:
- ...
```

5. **PASS** → 调用 MCP `mark_complete`（可带 `note`）。这是唯一把 run 标为 `completed` 的合法路径。  
6. **FAIL** → `rework`（带缺口说明），或向用户报告；**不要** `mark_complete`。
