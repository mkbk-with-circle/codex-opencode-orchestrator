---
name: opencode-review
description: >
  Final verification via review_context. Requires bound workspace (enforced).
  Use for $opencode-review.
---

# OpenCode Review

1. `get_workspace`：未绑定则先 `set_workspace`。  
2. MCP `review_context` 加载 plan / brief / run。  
3. 在**绑定业务仓**里读文件、跑验收命令；不信任执行器自评。  
4. 输出：

```
VERDICT: PASS | FAIL
Evidence:
- ...
Gaps / next:
- ...
```
