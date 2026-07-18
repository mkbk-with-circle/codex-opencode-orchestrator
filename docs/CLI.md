# 用 Codex CLI 跑编排工作流（推荐）

Clone 后请先跑一次：

```bash
bash scripts/install.sh --smoke
```

这会：构建 bridge、把 MCP 写进 `~/.codex/config.toml`（**绝对路径**）、把 Skills 链到 `~/.agents/skills`。

## 三步开始

```bash
# 1. 安装（只需一次）
git clone <repo> && cd codex-opencode-orchestrator
bash scripts/install.sh --smoke

# 2. 指定业务仓（OpenCode 真正改代码的地方）
bash scripts/set-workspace.sh ~/Projects/YourApp
# 或: export PATH="$PWD/bin:$PATH" && orch workspace ~/Projects/YourApp

# 3. 在业务仓打开 Codex
cd ~/Projects/YourApp
bash /path/to/codex-opencode-orchestrator/scripts/codex-in-workspace.sh
# 或: orch
```

对话里用 `/dispatch` `/status` `/review`（Skills 已在用户目录，任意 cwd 可用）。

## 可选 PATH

```bash
export PATH="$HOME/path/to/codex-opencode-orchestrator/bin:$PATH"
orch help
orch doctor
orch watch --interval 30
```

## 定时轮询可以吗？

**Codex CLI 没有内置 cron。** 用外部循环即可：

| 模式 | 命令 | 作用 |
|------|------|------|
| 只盯状态 | `orch watch --interval 30` | 每 30s 打 status/progress |
| 跑完退出 | `orch watch --until-done --interval 15` | 适合脚本/CI |
| 变化时唤醒大脑 | `orch watch --ask-on-change --interval 30` | 状态变了 → `codex exec` 监督一句 |
| 卡住再问 | `orch watch --ask-on-stall 120 --interval 30` | 120s 无进展 → 唤醒 Codex |

实现：`scripts/watch-run.sh`（shell sleep + bridge CLI；可选再调 `codex exec`）。

也可用系统定时器（launchd / cron）周期性跑：

```bash
orch watch --once --ask-on-change
```

## 与 App 的分工

| | Codex CLI | Codex App |
|--|-----------|-----------|
| 工作目录 | 当前业务仓 (`-C`) | 打开的文件夹 |
| MCP | `install.sh` 写入用户配置（任意目录） | 项目 `.codex/config.toml` |
| Skills | `~/.agents/skills` 软链 | 打开编排仓时读 `.agents/skills` |
| 定时监督 | `orch watch` | 需手动点或外部脚本 |

## 健康检查

```bash
bash scripts/doctor.sh
```

## Codex 二进制

优先 PATH 里的 `codex`；否则 ChatGPT / Codex.app 自带 CLI。安装：

```bash
npm i -g @openai/codex
# 或
brew install --cask codex
```
