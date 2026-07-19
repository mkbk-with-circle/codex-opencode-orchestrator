# Codex ↔ OpenCode Orchestrator

**Codex** 负责规划与监督，**OpenCode** 在业务项目里改代码。

## 5 分钟上手

```bash
git clone https://github.com/mkbk-with-circle/codex-opencode-orchestrator.git
cd codex-opencode-orchestrator
bash scripts/install.sh --smoke          # 一次：装 bridge + 注册 MCP/Skills
bash scripts/set-workspace.sh ~/你的项目  # 绑定业务仓（必做）

# 可选：方便以后敲 orch
echo 'export PATH="'"$PWD"'/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc

cd ~/你的项目
orch                    # 或: bash …/scripts/codex-in-workspace.sh
```

在 Codex 里用 **`$` Skills**（不要用内置 `/plan`）：

| 你要做的 | 输入 |
|----------|------|
| 写计划 | `$opencode-plan` |
| 派工 | `$opencode-dispatch` |
| 看进度 | `$opencode-supervise` |
| 验收 | `$opencode-review` |
| 开始 / 取消轮询 | `$opencode-poll` / `$opencode-poll-cancel` |

完整说明 → **[docs/USAGE.md](docs/USAGE.md)**  
给模型看的规则 → [`AGENTS.md`](AGENTS.md)

## 常用命令

```bash
orch                  # 本业务仓开新会话
orch resume           # 恢复本仓最近会话
orch sessions         # 列出本仓会话
orch poll start       # plan 变更才唤醒会话
orch poll stop
orch doctor           # 健康检查
orch workspace        # 看当前绑定
```

## 默认与安全

- 默认执行器是 **mock**（不用 API Key 也能冒烟）。真跑 OpenCode：改 `config/orchestrator.yaml`，并在 `.env` 填密钥。
- 不要提交 `.env`。
