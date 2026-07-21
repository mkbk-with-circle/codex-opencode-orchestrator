# Codex ↔ OpenCode Orchestrator

Codex 负责规划与监督；OpenCode 在业务项目中改代码。日常入口为命令行工具 `orch`。

## 上手

```bash
git clone https://github.com/mkbk-with-circle/codex-opencode-orchestrator.git
cd codex-opencode-orchestrator
bash scripts/install.sh --smoke
```

安装脚本会把 `bin/` 写入 shell 配置。若当前终端找不到 `orch`：

```bash
export PATH="$PWD/bin:$PATH"
orch workspace ~/你的项目
cd ~/你的项目
orch
```

验证：`command -v orch`。也可将上述 PATH 写入 `~/.zshrc` / `~/.bashrc`。

## Skills

在 Codex 中输入 `$`（不要使用内置 `/plan`）：

| 用途 | Skill |
|------|-------|
| 写计划 | `$opencode-plan` |
| 派工 | `$opencode-dispatch` |
| 看进度 | `$opencode-supervise` |
| 验收 | `$opencode-review` → `mark_complete` |
| 需要凭据或决策 | `$opencode-ask-user` |
| 轮询 | `$opencode-poll` / `$opencode-poll-cancel` |

- 总览：[docs/USAGE.md](docs/USAGE.md)  
- orch 命令：[docs/ORCH.md](docs/ORCH.md)  
- 配置：[config/README.md](config/README.md)  
- 模型规则：[AGENTS.md](AGENTS.md)

## 常用命令

```bash
orch help
orch workspace ~/项目
orch
orch resume
orch sessions
orch use
orch use <profile>
orch poll start
orch poll stop
orch doctor
```

## 默认与安全

- 默认 profile：`ikuncode-haiku`（`orch use` 切换）。  
- 在 `.env` 填写真实 API Key。  
- 不要提交 `.env` 与 `config/active.local.yaml`。
