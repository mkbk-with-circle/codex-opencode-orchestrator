---
name: opencode-plan
description: >
  把用户任务写成已绑定业务仓的 plan（经 MCP write_plan）。
  当用户说写计划、落盘 plan、$opencode-plan 时使用。
  不要与 Codex 内置 Plan mode 混淆。未绑定则先 set_workspace。
---

# OpenCode 写 Plan

## 落盘规则

1. 先 `get_workspace`：若 `bound` 为 false → **只**调用 `set_workspace`，向用户要业务仓绝对路径，**不要**自己用 Apply Patch 写到编排仓 `plans/`。  
2. 已绑定后：用 MCP **`write_plan`**（`task` + `content`）写入。  
   文件落在：`{targetWorkspace}/.orchestrator/plans/<task>.md`  
3. 禁止把 plan / brief 写到编排仓 `codex-opencode-orchestrator/`（`plans/` 只有模板；brief 落在业务仓 `.orchestrator/briefs/`）。  
4. `write_plan` 会自动注入 `workspace:` frontmatter 为绑定目录。

## content 模板（步骤必须可打勾）

```markdown
# <标题>

## 目标
一句话。

## 范围
- …

## 非范围
- …

## 步骤
> OpenCode：每完成一个 phase，把对应行从 `- [ ]` 改成 `- [x]` 并保存。不要删步骤。  
> 缺 Cookie/账号/验证码/人工选择等时：写 needs-user（keepAlive）并用 wait-reply 等人；禁止拆掉现场后重开。  
> Codex：根据验收标准判断整体是否完成，再 `mark_complete`。

- [ ] 第一步……
- [ ] 第二步……
- [ ] 第三步……

## 验收标准（总）
给人看的说明。

## 验收命令
- 验收: `test -f path`
- 验收: `grep -q 'x' path`
```

**强制：** `## 步骤` 里每一项必须是 `- [ ] …`（GitHub checkbox），禁止写成 `1. 2. 3.` 有序列表。  
这样 OpenCode 完成后打勾，Codex 读同一文件即可看进度。

（不必手写 YAML frontmatter；程序会加。）

## 完成后

展示 `planPath`、`workspace`、`plansDir`；问是否 `$opencode-dispatch`（`planPath` 用 task 名即可）。
