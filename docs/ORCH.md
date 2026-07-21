# orch 命令参考

命令行入口 `bin/orch`。安装与工作流见 [USAGE.md](./USAGE.md)；API/模型配置见 [config/README.md](../config/README.md)。

---

## 命令一览

| 命令 | 作用 |
|------|------|
| `orch` / `orch shell` | 在当前或已绑定业务仓打开新的 Codex 会话 |
| `orch exec …` | 非交互执行一轮 `codex exec`（脚本、自动化） |
| `orch workspace [路径]` | 查看或绑定业务仓 |
| `orch set-workspace <路径>` | 绑定业务仓（与上等价） |
| `orch sessions` | 列出本业务仓相关 Codex 会话 |
| `orch resume [id\|名\|#]` | 恢复本仓 Codex 会话（不是 OpenCode bridge resume） |
| `orch session pin <名>` | 为本仓最近会话起别名 |
| `orch session last` | 打印本仓最近会话 id |
| `orch use` / `orch profiles` | 列出 API/模型 profile |
| `orch use <名>` | 切换商家或同一商家下的模型 |
| `orch poll start` | 开始 plan / needs-user 变更轮询 |
| `orch poll stop` | 停止轮询 |
| `orch wait-reply` | 阻塞等待用户回复（keepAlive） |
| `orch provide-reply` | 写入用户回复，结束 wait-reply |
| `orch begin-hold` | 写入 needs-user.md / hold.json |
| `orch bridge <子命令>` | 调用 bridge CLI（派工、状态、验收等） |
| `orch doctor` | 检查安装、MCP、Skills |
| `orch install […]` | 重新安装 |
| `orch smoke` | mock 派工冒烟测试 |
| `orch help` | 短帮助 |

---

## 会话与业务仓

```bash
orch workspace ~/Projects/YourApp
orch set-workspace ~/Projects/YourApp
orch workspace                  # 查看绑定状态

cd ~/Projects/YourApp
orch                            # 新开 Codex（自动绑定当前目录）
orch exec "总结当前仓库结构"    # 无 TUI，跑完退出

orch sessions
orch resume                     # 最近一条
orch resume 1                   # 列表第 1 条
orch session pin 我的任务
orch resume 我的任务
orch session last               # 输出 uuid，可供 poll --session 使用
```

绑定后业务仓目录：

- `.orchestrator/plans/` — plan  
- `.orchestrator/briefs/` — 派工 brief（可用 `ORCHESTRATOR_SAVE_BRIEFS=0` 关闭落盘）  
- `.orchestrator/runs/` — 每次派工的 `state.json`  

---

## 切换 API / 模型

先看有哪些名字（来自 `config/profiles.yaml`）：

```bash
orch use
```

再写成：`orch use` + 空格 + **上面列出的 name**（不是随便写模型全名）：

```bash
orch use ikuncode-haiku      # IKunCode Haiku（便宜）
orch use ikuncode-sonnet     # IKunCode Sonnet（更强）
orch use siliconflow-v3      # 换到 SiliconFlow（需 SILICONFLOW_API_KEY）
orch use mock                # 不调真实 API
```

同商家换模型（如 haiku → sonnet）且有进行中 OpenCode 会话时，会尽量保留上下文。换商家则下一轮派工才生效。

---

## 轮询

```bash
orch poll start --interval 60
orch poll start --interval 60 --session <uuid>
orch poll stop
```

仅当 `.orchestrator/plans/` 或 `needs-user.md` 有变更时，才对指定会话执行 `codex exec resume`。对话内也可用 `$opencode-poll` / `$opencode-poll-cancel`。

---

## 需要用户输入时

执行端保持现场并等待：

```bash
orch begin-hold --kind otp --hint 'browser SMS page'
orch wait-reply --timeout 900
```

写入回复：

```bash
orch provide-reply --reply '123456'
```

在同一 OpenCode 会话继续（不要使用会中断会话的 `rework`）：

```bash
orch bridge resume --message '在当前页提交验证码' --reply '123456'
```

---

## bridge 子命令

需已绑定业务仓。

```bash
orch bridge workspace
orch bridge list-plans
orch bridge status [--run <runId>]
orch bridge progress [--run <runId>]
orch bridge review [--run <runId>]
orch bridge mark-complete [--run <runId>]
orch bridge interrupt [--run <runId>]
orch bridge dispatch --no-confirm --plan <任务名>
orch bridge rework --extra '…' [--run <runId>]   # 会中断当前会话
orch bridge resume --message '…' [--reply '…'] [--run <runId>]
```

日常派工与验收优先在 Codex 中使用 `$opencode-*` Skills。

---

## 安装与自检

```bash
orch doctor
orch install
orch install --smoke
orch install --workspace ~/Projects/YourApp
orch smoke
bash scripts/setup-opencode.sh      # 未安装 OpenCode CLI 时
```
