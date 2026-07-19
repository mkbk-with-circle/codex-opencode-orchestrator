---
name: opencode-poll
description: >
  启动 plan 变更轮询：每隔固定时间检查绑定仓 plans 是否被改；改了才唤醒当前会话查进度。
  用户说 $opencode-poll、开始轮询、poll start 时使用。取消用 $opencode-poll-cancel。
---

# 启动轮询（只要这一个开始命令）

## 做一件事

用 shell 执行（把 ORCH 换成编排仓路径，INTERVAL 默认 60）：

```bash
bash "$ORCH/bin/orch" poll start --interval 60
```

若能知道当前会话 UUID，务必带上（保证唤醒的是**本会话**）：

```bash
bash "$ORCH/bin/orch" poll start --interval 60 --session <当前会话uuid>
```

会话 id 常在 Codex 会话元数据 / rollout 文件名末尾 UUID；若你能从上下文读到 session id，必须传入。

## 行为（向用户确认一句）

- 后台每隔 N 秒看 `{绑定仓}/.orchestrator/plans/*.md` 是否变更  
- **有变更** → `codex exec resume <本会话>` 醒一次查 status/progress  
- **无变更** → 不调模型（省 token）  
- 取消：`$opencode-poll-cancel` 或 `orch poll stop`

## 禁止

- 不要再用旧的 `watch-run.sh` 一堆参数  
- 不要自己 sleep 循环空转喊模型  
