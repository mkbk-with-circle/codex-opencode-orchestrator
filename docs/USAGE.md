# 使用说明

一张图理清两件事：

```text
编排仓（本仓库）     → Skills / MCP / runs 状态
业务仓（你的项目）   → 真正改代码；plan 也写在这里
```

必须先 **绑定业务仓**，否则 plan / 派工 / 验收会被程序拒绝。

---

## 1. 安装（只做一次）

**前提：** Node ≥ 18；已装 Codex CLI（或 ChatGPT / Codex 桌面端）；`codex login`。

```bash
git clone https://github.com/mkbk-with-circle/codex-opencode-orchestrator.git
cd codex-opencode-orchestrator
bash scripts/install.sh --smoke
bash scripts/doctor.sh          # 期望 DOCTOR_OK
```

`install.sh` 会：构建 bridge、注册 MCP、把 Skills 链到 `~/.agents/skills`。

建议把 `bin/` 加进 PATH，以后直接用 `orch`：

```bash
echo 'export PATH="'"$PWD"'/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

---

## 2. 绑定业务仓

```bash
bash scripts/set-workspace.sh ~/Projects/YourApp
orch workspace                  # bound: true
```

之后：

- 代码改动只发生在该目录  
- Plan 路径：`{业务仓}/.orchestrator/plans/<任务>.md`

---

## 3. 日常工作流

```bash
cd ~/Projects/YourApp
orch                            # 新开 Codex（自动绑定当前目录）
```

对话里（输入 `$` 选 Skill，**不要**用 Codex 自带的 `/plan`）：

1. `$opencode-plan` — 写计划并落盘  
2. `$opencode-dispatch` — 派工  
3. `$opencode-supervise` — 查一次进度  
4. `$opencode-review` — 验收  

| Skill | 作用 |
|-------|------|
| `$opencode-plan` | 写 plan |
| `$opencode-dispatch` | 派工 |
| `$opencode-supervise` | 单次查进度 |
| `$opencode-poll` | 开始轮询 |
| `$opencode-poll-cancel` | 取消轮询 |
| `$opencode-review` | 终验 |

---

## 4. 会话：下次怎么回来

会话按 **业务仓目录** 过滤：

```bash
cd ~/Projects/YourApp
orch sessions              # 只看本仓
orch resume                # 最近一条
orch resume 1              # 列表第 1 条
orch session pin 我的任务   # 起别名
orch resume 我的任务
```

新开会话仍用 `orch`；退出后会自动记下本仓「最近会话」。

---

## 5. 轮询（只要两个命令）

```bash
orch poll start --interval 60    # 或对话里 $opencode-poll
orch poll stop                   # 或 $opencode-poll-cancel
```

逻辑：每隔 N 秒看 `.orchestrator/plans/` **有没有改文件**。  
没改 → 不调模型；改了 → 唤醒启动时绑定的那条会话去查进度。

可显式指定会话：`orch poll start --interval 60 --session <uuid>`。

说明：唤醒是给该会话 **追加一轮**（resume），不是往正在开着的输入框里打字。

---

## 6. 接真 OpenCode（可选）

默认是 **mock**，不用 Key。要真跑时：

1. 编辑 `.env`，填入 `SILICONFLOW_API_KEY`  
2. `config/orchestrator.yaml` 里改 `default_executor`（见 `config/executors.yaml`）  
3. 按需：`bash scripts/setup-opencode.sh`  
4. 再 `$opencode-dispatch`

不要提交 `.env`。

---

## 7. 常见问题

| 现象 | 处理 |
|------|------|
| 派工/写 plan 报未绑定 | `set-workspace.sh` / `orch workspace` |
| 没有 `$opencode-*` | 重跑 `install.sh`；对话里输入 `$` |
| `/plan` 不对劲 | 那是 Codex 内置 Plan mode；用 `$opencode-plan` |
| 找不到 `codex` | 装 CLI，或让 `install.sh` 用桌面端自带路径 |
| `doctor` 失败 | 按提示重跑 `install.sh` |

维护者本地配置备份恢复：`bash scripts/restore-local-backup.sh`。
