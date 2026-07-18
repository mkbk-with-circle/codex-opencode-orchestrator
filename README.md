# Codex ↔ OpenCode Orchestrator

**Codex（大脑）** 规划 / 监督 · **OpenCode（手脚）** 在业务仓改代码。

## Clone 后 3 步

```bash
git clone <this-repo> && cd codex-opencode-orchestrator
bash scripts/install.sh --smoke          # 构建 + 配置本机 Codex CLI（MCP/Skills）
bash scripts/set-workspace.sh ~/Projects/YourApp
cd ~/Projects/YourApp && bash /path/to/codex-opencode-orchestrator/scripts/codex-in-workspace.sh
```

把 `bin/` 加进 PATH 后可简写为 `orch` / `orch doctor` / `orch watch`。

| 文档 | 内容 |
|------|------|
| [docs/CLI.md](docs/CLI.md) | Codex CLI 工作流（推荐） |
| [docs/WATCH.md](docs/WATCH.md) | 定时轮询监督 |
| [docs/WORKSPACE.md](docs/WORKSPACE.md) | 业务仓怎么指定 |
| [`AGENTS.md`](AGENTS.md) | 斜杠命令与规则 |

## 日常 workflow

1. 在 Codex 里把 plan 落到 `plans/`（编排仓）
2. `/dispatch` → MCP bridge 启动 run（OpenCode 在 **TARGET_WORKSPACE**）
3. `/status` 或挂着 `orch watch --interval 30`
4. `/review` 对照 plan 验收

## 执行器

- 默认演示：`config/orchestrator.yaml` → `default_executor: mock`
- 真跑 OpenCode：改为 `siliconflow-opencode`，并配置 `.env` 里的 `SILICONFLOW_API_KEY`（`cp .env.example .env`）

可选：`bash scripts/setup-opencode.sh`

## 安全

- 不要提交 `.env`
- 破坏性 shell / 批量删除需确认门禁

## 布局

`.agents/skills/` · `packages/bridge/` · `plans/` `briefs/` `runs/` · `scripts/install.sh`
