---
name: opencode-poll
description: >
  启动 v2 事件 supervisor，按持久化 cursor 唤醒专用 Codex 会话审查新事件。
---

# 启动 v2 supervisor

执行：

```bash
bash "$ORCH/bin/orch" watch start --run <runId> --session <专用Codex会话UUID> --interval 60
```

- 推荐使用专用 supervisor session，禁止后台并发 resume 用户正在操作的规划会话。
- supervisor 消费 `events.jsonl`，成功处理后才推进 durable cursor。
- 无事件时不调用 Codex。
- 停止使用 `$opencode-poll-cancel` 或 `orch watch stop`。
