---
name: opencode-poll
description: >
  启动 plan 变更轮询：每隔固定时间检查绑定仓 plans 是否被改；改了才唤醒当前会话查进度。
  用户说 $opencode-poll、开始轮询、poll start 时使用。取消用 $opencode-poll-cancel。
---

# 启动轮询

执行（将 ORCH 换成编排仓路径，INTERVAL 默认 60）：

```bash
bash "$ORCH/bin/orch" poll start --interval 60
```

若已知当前会话 UUID，应加上 `--session`，避免唤醒错误会话：

```bash
bash "$ORCH/bin/orch" poll start --interval 60 --session <当前会话uuid>
```

会话 id 通常出现在 Codex 会话元数据或 rollout 文件名末尾。

## 行为

- 每隔 N 秒检查 `{绑定仓}/.orchestrator/plans/*.md` 是否变更  
- 有变更 → `codex exec resume` 查询 status/progress  
- 无变更 → 不调用模型  
- 取消：`$opencode-poll-cancel` 或 `orch poll stop`

不要自行 sleep 循环空转调用模型。
