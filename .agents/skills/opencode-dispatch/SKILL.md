---
name: opencode-dispatch
description: >
  把已落盘 plan 派给执行器。必须先绑定工作目录（程序强制）。
  用户说派工、$opencode-dispatch 时使用。CLI 用 $ 调用，不是内置 / 菜单。
---

# OpenCode 派工

## 门禁

1. `get_workspace`：`bound` 必须为 true，否则先 `set_workspace`，**不要**调用 `dispatch`。  
2. `list_plans` 确认 plan 在绑定仓 `.orchestrator/plans/`。  
3. `dispatch`：`planPath` 用任务名（如 `pku-treehole-favorites`）或绝对路径；**不要**传与绑定不一致的 `workspace`（程序会拒绝）。  
4. 回报 `runId` + `workspace` 绝对路径。  
5. 提醒：plan 的 `## 步骤` 是 `- [ ]` 清单；OpenCode **只**负责把完成的 phase 改成 `- [x]`。  
6. **任务是否完成由 Codex 判定**：OpenCode idle / `awaiting_review` ≠ completed；验收 PASS 后调用 `mark_complete`。

## 注意

- 未绑定就派工  
- 假设 plan 在编排仓 `plans/`  
- 未展示 workspace 就开始执行  
