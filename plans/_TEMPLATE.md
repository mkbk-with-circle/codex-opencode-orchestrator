---
workspace: REPLACE_WITH_ABS_PATH
task: example-task
---

# 示例任务标题

## 目标

一句话说明要达成什么。

## 范围

- 允许改动的路径 / 文件

## 非范围

- 明确不做的事

## 步骤

> OpenCode：每完成一个 phase，把对应行从 `- [ ]` 改成 `- [x]` 并保存。不要删步骤。  
> 缺 Cookie/账号/验证码/人工选择等时：写 `.orchestrator/needs-user.md`（keepAlive）并用 wait-reply 等人；禁止关现场重开。  
> Codex：根据验收标准判断整体是否完成，再 `mark_complete`（勾选齐全 ≠ 任务完成）。

- [ ] 第一步……
- [ ] 第二步……
- [ ] 第三步……

## 验收标准（总）

给人看的验收说明（不是 shell）。

## 验收命令

- 验收: `test -f path/to/file`
- 验收: `grep -q '期望字符串' path/to/file`
