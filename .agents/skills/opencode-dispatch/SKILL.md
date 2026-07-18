---
name: opencode-dispatch
description: >
  把已落盘 plan 派给 OpenCode；必须明确目标工作目录（业务项目路径）。
  当用户说 /dispatch、开始执行，或调用 $opencode-dispatch 时使用。
---

# OpenCode 派工

## 双目录模型（必读）

| 目录 | 作用 | 你在 Codex 里打开谁 |
|------|------|-------------------|
| **编排仓** `codex-opencode-orchestrator` | Skills / MCP / plans / runs | **打开这个** 才能用 `/dispatch` 等 |
| **业务仓**（Target Workspace） | OpenCode 真正改代码 / build 的地方 | 用 `set_workspace` 或 dispatch 的 `workspace` 指定 |

派工前先调用 `get_workspace`，把返回的 `targetWorkspace` 展示给用户确认。

## 步骤

1. `get_workspace`：若还是默认 `playground` 且用户要做真实项目 → 调用 `set_workspace` 或要求用户提供绝对路径。  
2. 确认 plan 已落盘（`plans/...`）。  
3. `dispatch`，**显式传** `workspace: "/绝对路径/业务项目"`（推荐），或依赖已 set 的默认。  
4. 确认 brief 时重点展示 **Working directory**。  
5. 回报 `runId` + **`workspace` 绝对路径**（用户必须知道 OpenCode 在哪 build）。

## 参数

- `workspace` — OpenCode cwd（绝对路径优先）  
- `planPath` / `executorId` / `confirmedToken` / …

## 禁止

- 不要默认假设业务代码在编排仓的 `playground/`（演示除外）  
- 不要在未展示 workspace 的情况下开始派工  
