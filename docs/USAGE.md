# 使用说明

> v2 是默认工作流。旧 `dispatch/status/review` 仅用于兼容已有 Run。

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
| `orch watch start\|stop\|status` | v2 事件 supervisor |
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
| `$opencode-review` | 逐 Phase 审查与最终完成门禁 |

### v2 生命周期

```text
draft Plan → validate_plan_v2 → 用户确认 → approve_plan_v2
→ start_run_v2 → dispatch_window_v2
→ OpenCode phase_start / phase_report
→ Codex review_context_v2 / review_phase
→ 下一授权窗口 → complete_run_v2
```

`- [x]` 只代表 OpenCode 声明 implemented。Codex 审查失败时会取消勾选并保留 attempt 历史。默认 `strict`；用户显式选择时可用有限 `batch`。第一版不支持多个 OpenCode 会话并行写同一个工作区。

需要 Cookie、验证码等时走 `$opencode-ask-user`；v2 keepAlive 场景让用户运行 `orch run reply --run <runId>` 无回显输入，并由执行器同会话继续，不要用会中断会话的 `rework`。

### 事件 supervisor

```bash
orch watch start --run <runId> --session <专用Codex会话UUID> --interval 60
orch watch status
orch watch stop
```

Supervisor 按 `events.jsonl` 和 durable cursor 工作。推荐专用 Codex 会话，避免后台并发恢复用户正在操作的规划 TUI。

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
