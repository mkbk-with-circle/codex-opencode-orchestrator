# 使用说明

```text
编排仓（本仓库）  → Skills / MCP / orch / 配置
业务仓（你的项目）→ 代码与 plan / brief / runs
```

未绑定业务仓时，plan、派工、验收会被拒绝。

- `orch` 命令详解 → [ORCH.md](./ORCH.md)  
- API / 模型配置 → [config/README.md](../config/README.md)

---

## 安装

前提：Node ≥ 18；已安装 Codex CLI（或桌面端）；已 `codex login`。

```bash
git clone https://github.com/mkbk-with-circle/codex-opencode-orchestrator.git
cd codex-opencode-orchestrator
bash scripts/install.sh --smoke
orch doctor
```

安装脚本会构建 bridge、注册 MCP、链接 Skills，并把 `orch` 加入 PATH。

```bash
orch workspace ~/Projects/YourApp
cd ~/Projects/YourApp
orch
```

若提示找不到 `orch`：

```bash
export PATH="$HOME/Desktop/codex-opencode-orchestrator/bin:$PATH"  # 改为实际路径
command -v orch && orch help
```

---

## orch 常用入口

| 命令 | 说明 |
|------|------|
| `orch workspace [路径]` | 绑定或查看业务仓 |
| `orch` | 打开本仓 Codex 会话 |
| `orch resume` / `orch sessions` | 恢复 / 列出会话 |
| `orch use` / `orch use <名>` | 查看或切换 API/模型 |
| `orch poll start\|stop` | 计划变更轮询 |
| `orch doctor` | 自检 |

完整子命令与示例见 [ORCH.md](./ORCH.md)。

绑定后业务仓下会有 `.orchestrator/plans|briefs|runs/`。

---

## 日常工作流（Codex Skills）

```bash
cd ~/Projects/YourApp
orch
```

在对话中输入 `$`（不要使用 Codex 内置 `/plan`）：

| Skill | 作用 |
|-------|------|
| `$opencode-plan` | 写 plan（步骤用 `- [ ]`） |
| `$opencode-dispatch` | 派工 |
| `$opencode-supervise` | 查进度 |
| `$opencode-ask-user` | 需要用户输入时提问 |
| `$opencode-poll` / `$opencode-poll-cancel` | 开始 / 取消轮询 |
| `$opencode-review` | 终验；通过后 `mark_complete` |

OpenCode 只负责把 phase 勾成 `- [x]`；任务是否完成只能由 Codex 调用 `mark_complete`。`awaiting_review` 或 idle 不等于完成。

需要 Cookie、验证码等时走 `$opencode-ask-user`；keepAlive 场景用 `orch provide-reply` 与 `orch bridge resume`，不要用会中断会话的 `rework`。

---

## 接入 OpenCode

1. 在 `.env` 填写 API Key（参考 `.env.example`）  
2. 在 `opencode.json` 注册 provider/models，用 `orch use` 选择 profile  
3. 若无 OpenCode CLI：`bash scripts/setup-opencode.sh`  
4. `$opencode-dispatch` 成功时 `executorType` 应为 `opencode-http`  

本地调试可用 `orch use mock`。不要提交 `.env` 与 `config/active.local.yaml`。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| 找不到 `orch` | 检查 PATH，见上文安装一节 |
| 未绑定 | `orch workspace ~/项目` |
| 没有 `$opencode-*` | 重跑 `orch install`，对话中输入 `$` |
| `/plan` 行为不对 | 使用 `$opencode-plan` |
| 找不到 `codex` | 安装 CLI，或由 install 使用桌面端路径 |
| `doctor` 失败 | 按提示执行 `orch install` |
| 换模型后丢上下文 | 同商家用 `orch use`；跨商家无法保留会话 |
