---
workspace: REPLACE_WITH_ABS_PATH
task: example-task
schemaVersion: 2
status: draft
executionMode: strict
batchSize: 1
---

# 示例任务标题

## 目标

一句话说明要达成什么。

## 范围

- 允许改动的路径 / 文件

## 非范围

- 明确不做的事

## 整个项目必须遵循的硬性规定

1. 不得修改 Plan 的目标、范围、硬性规定、Phase 定义和验收标准。
2. 不得 push 或修改 Git remote。
3. 只允许修改当前 Phase 声明的路径。

## 步骤

> OpenCode：每完成一个 phase，把对应行从 `- [ ]` 改成 `- [x]` 并保存。不要删步骤。  
> 缺 Cookie/账号/验证码/人工选择等时：写 `.orchestrator/needs-user.md`（keepAlive）并用 wait-reply 等人；禁止关现场重开。  
> Codex：根据验收标准判断整体是否完成，再 `mark_complete`（勾选齐全 ≠ 任务完成）。

- [ ] P01 — 第一步……
  - 依赖：无
  - 允许修改：src/**, test/**
  - 验收标准：说明可观察结果
  - 验收命令：`npm test`
  <!-- OPENCODE REPORT P01 START -->
  status: pending
  comment:
  evidence:
  <!-- OPENCODE REPORT P01 END -->

- [ ] P02 — 第二步……
  - 依赖：P01 accepted
  - 允许修改：src/**, test/**
  - 验收标准：说明可观察结果
  - 验收命令：`npm test`
  <!-- OPENCODE REPORT P02 START -->
  status: pending
  comment:
  evidence:
  <!-- OPENCODE REPORT P02 END -->

## 验收标准（总）

给人看的验收说明（不是 shell）。

## 验收命令

- 验收: `test -f path/to/file`
- 验收: `grep -q '期望字符串' path/to/file`
