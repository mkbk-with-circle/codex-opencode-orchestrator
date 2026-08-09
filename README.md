# Codex ↔ OpenCode Orchestrator

[![CI](https://github.com/mkbk-with-circle/codex-opencode-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/mkbk-with-circle/codex-opencode-orchestrator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

让 **Codex 做大脑**，让 **OpenCode 做执行 Harness**：Codex 负责和用户澄清需求、冻结分阶段 Plan、审查结果和处理异常；OpenCode 只实现当前被授权的 Phase；本项目负责保存状态、限制顺序、传递报告和恢复会话。

默认采用严格串行流程：OpenCode 完成 P01 → Codex 验收 P01 → 才开放 P02。第一版不允许多个 OpenCode 会话并行写同一工作区。

## 开始之前

本项目目前面向 macOS 和 Linux。Windows 用户建议使用 WSL。你需要先准备：

- Git；
- Node.js 18 或更高版本（包含 npm），可从 [Node.js 官网](https://nodejs.org/) 安装；
- Codex CLI；
- OpenCode CLI；
- 至少一个可供 OpenCode 使用的模型 Provider 及其 API Key。

Codex 和 OpenCode 是两个独立的命令行程序，登录和模型配置也彼此独立。Codex 的账号不会自动提供给 OpenCode，本仓库也不附带任何 API Key。

### 1. 安装并登录 Codex CLI

macOS/Linux 可按 [Codex CLI 官方教程](https://developers.openai.com/codex/cli/) 安装：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

第一次运行 `codex` 时，按提示选择使用 ChatGPT 登录或其他可用的登录方式。个人配置位于 `~/.codex/config.toml`；模型、权限和其他选项见 [Codex 配置教程](https://developers.openai.com/codex/config-basic/)。

确认安装成功：

```bash
codex --version
```

### 2. 下载本项目

```bash
git clone https://github.com/mkbk-with-circle/codex-opencode-orchestrator.git
cd codex-opencode-orchestrator
```

后面的安装命令都在这个目录中执行。

### 3. 安装并配置 OpenCode

你可以使用本项目的安装脚本，也可以按照 [OpenCode 官方安装教程](https://opencode.ai/docs) 自行安装：

```bash
bash scripts/setup-opencode.sh
export PATH="$HOME/.opencode/bin:$PATH"
opencode --version
```

如果你还没有模型 Provider，先在终端运行 `opencode`，然后输入 `/connect`，按照界面添加 Provider 和 API Key。官方说明见 [Provider 配置](https://opencode.ai/docs/providers) 和 [模型配置](https://opencode.ai/docs/models)。

本项目也支持 OpenAI-compatible Provider，详见下文“配置 OpenCode 模型”。不要把 API Key 写进 `opencode.json`、Plan、源码或 Git。

### 4. 安装 Orchestrator

```bash
bash scripts/install.sh
```

安装脚本会：

1. 创建未纳入 Git 的 `.env`；
2. 安装依赖、构建并测试 bridge；
3. 向 Codex 注册 `opencode_bridge` MCP；
4. 把 `$opencode-*` Skills 链接到 `~/.agents/skills/`；
5. 把 `orch` 写入当前用户的 shell PATH。

安装结束后新开一个终端，或者在当前终端执行：

```bash
export PATH="$PWD/bin:$PATH"
orch doctor
```

`orch doctor` 的关键检查都显示 `OK` 后，再继续下一步。

## 配置 OpenCode 模型

默认 profile 是 Claude Haiku 4.5：`ikuncode/claude-haiku-4-5-20251001`。它使用第三方 IKunCode Provider，需要你自行取得 API Key，然后编辑本仓库的 `.env`：

```dotenv
IKUNCODE_API_KEY=填写你自己的Key
```

验证并启用：

```bash
orch model list
orch model check ikuncode-haiku
orch model use ikuncode-haiku
```

如果你使用其他 OpenAI-compatible Provider，可直接注册：

```bash
orch model add \
  --name my-fast-model \
  --model my-provider/model-id \
  --base-url https://api.example.com/v1 \
  --api-key-env MY_PROVIDER_API_KEY \
  --activate
```

再把真实 Key 写进本仓 `.env` 或 `~/.config/codex-opencode-orchestrator/secrets.env`：

```dotenv
MY_PROVIDER_API_KEY=填写你自己的Key
```

然后运行：

```bash
orch model check my-fast-model
```

配置只保存环境变量名，`orch model add` 不接收也不打印真实 Key。更多示例见 [`config/README.md`](config/README.md)。Codex 使用什么模型，仍由 Codex CLI 自己的 `/model` 或 `~/.codex/config.toml` 控制。

## 第一次运行

### 1. 准备并绑定业务仓

业务仓是 OpenCode 真正修改代码的目录，必须是 Git 仓库根目录：

```bash
mkdir -p ~/Projects/YourApp
cd ~/Projects/YourApp
git init                         # 已经是 Git 仓库时跳过
orch workspace "$PWD"
```

一个 Orchestrator 安装一次只能绑定一个当前业务仓；切换项目时再次执行 `orch workspace /新路径`。

### 2. 从业务仓启动 Codex

```bash
cd ~/Projects/YourApp
orch
```

然后在 Codex 对话中输入：

```text
$opencode-plan 我想实现……请先和我澄清需求并写一份多阶段 Plan
```

Plan 保持 draft，直到校验通过且你明确批准。批准后再输入：

```text
$opencode-dispatch
```

常用 Skills：

| Skill | 用途 |
|---|---|
| `$opencode-plan` | 澄清需求并生成多阶段 Plan |
| `$opencode-dispatch` | 建立 Run，派发当前授权 Phase |
| `$opencode-supervise` | 查看 Run、Phase、事件和心跳 |
| `$opencode-review` | Codex 独立验收，决定 accept / rework / needs_user |
| `$opencode-ask-user` | 账号、验证码或用户决策的人工门禁 |
| `$opencode-poll` | 启动定时事件 supervisor |
| `$opencode-poll-cancel` | 停止 supervisor |

不要把 Codex 内置 `/plan` 当成本项目的编排 Plan。

## 工作流与状态

```text
draft Plan → 用户检查 → validate → approve
→ start Run → dispatch 当前窗口
→ OpenCode 报告 implemented / failed / blocked
→ Codex 独立审查 → 下一 Phase
→ 全部 accepted + 总体验收 → completed
```

`- [x]` 只表示 OpenCode 声明“已实现”，不表示审查通过。只有 Codex 能接受 Phase 和完成 Run。`idle` 也永远不等于 Phase 完成。

Plan、状态和证据位于业务仓：

```text
.orchestrator/plans/            可审阅、可纳入版本控制的 Plan
.orchestrator/runs/             本地 Run 状态、事件和证据（忽略提交）
.orchestrator/needs-user.md      当前人工门禁（忽略提交）
```

## Plan 契约

从 [`plans/_TEMPLATE.md`](plans/_TEMPLATE.md) 开始。每个 Plan 必须包含：

- 整个项目持续生效的硬性规定；
- 稳定 Phase ID（P01、P02……）、依赖和允许路径；
- 可复现的验收标准与命令；
- OpenCode 报告区与 Codex 审查区。

批准后，目标、范围、硬性规定、Phase 顺序和验收条件由 SHA-256 契约哈希保护。改变需求应新建版本并重新让用户批准。

常用 CLI：

```bash
orch plan validate --plan task
orch plan approve --plan task
orch run start --plan task --mode strict
orch run dispatch --run <runId>
orch run status --run <runId>
orch phase acceptance --run <runId> --phase P01
orch phase review --run <runId> --phase P01 --verdict accept --summary verified
orch run complete --run <runId>
```

用户明确选择时可用 `--mode batch --batch-size N`；仍由一个 OpenCode session 按顺序执行，失败或阻塞立即停止窗口。

## OpenCode 接入与权限边界

派工会自动启动或复用仅监听 loopback 的 OpenCode HTTP Server；自动启动时会生成本机 `0600` 认证文件，并为其提供专用 `orchestrator_reporter` MCP。这个 MCP 只暴露：

- `phase_start`
- `phase_report`
- `wait_for_human_reply`

Codex 的 `review_phase`、`retry_phase`、`complete_run_v2` 不会暴露给 OpenCode。每次派工还会探测 `/mcp` 状态并自动修复失效的 reporter。OpenCode 被禁止访问业务工作区以外的路径。

这是职责和权限分层，不是操作系统级安全沙箱。不可信代码仍应放进容器、虚拟机或独立系统账号运行。

## 密码、验证码与保持现场

不要把账号、密码、Cookie、Token 或验证码写进 Plan、brief、源码、Git 或普通日志。

执行器遇到登录或 OTP 时会：

1. 用 `phase_report(outcome=blocked, keepAlive=true, holdKind=credentials|otp)` 暂停当前 Phase；
2. 保持同一个 OpenCode session、浏览器或 CLI 现场；
3. 在同一 attempt 内调用 `wait_for_human_reply`；
4. Codex 向用户提问；用户在自己的终端运行 `orch run reply --run <runId>`，通过无回显提示投递；
5. 执行器收到回复后继续原现场，不重新开始登录。

敏感回复按 `run + phase + attempt + waitToken` 绑定，写入权限为 `0600` 的一次性文件，不进入 shell 参数或事件 payload。Reporter 只把不透明文件路径交给 OpenCode，不把秘密正文写入模型消息；执行程序必须直接消费并立即删除该文件，禁止 OpenCode 用 `read` 或 `cat` 查看。高安全场景建议由用户在受控终端或浏览器中亲自输入。

## 自动监督与恢复

```bash
orch watch start --run <runId> --session <专用Codex会话ID> --interval 60
orch watch status
orch watch stop
```

Supervisor 消费追加式 `events.jsonl` 和持久化 cursor。只有出现 implemented、failed、blocked 或协议违规事件才唤醒专用 Codex 会话；重启后从上次确认位置继续。

升级旧 Plan 默认生成新文件，不覆盖原文件：

```bash
orch plan migrate --plan legacy.md
```

需要原位迁移时使用 `--in-place`，工具会先建立带时间戳的备份。迁移结果始终保持 draft，必须由用户复核后才能批准。

## 排错

先执行：

```bash
orch doctor
orch model check <profile>
```

| 现象 | 处理 |
|---|---|
| `codex: command not found` | 按上面的 Codex 官方教程安装，重开终端，再运行 `codex --version` |
| `opencode: command not found` | 运行 `bash scripts/setup-opencode.sh`，把 `~/.opencode/bin` 加入 PATH，或设置绝对路径 `OPENCODE_BIN` |
| `orch: command not found` | 重开终端；或运行 `export PATH="/path/to/codex-opencode-orchestrator/bin:$PATH"` |
| 模型检查失败 | 确认 `.env` 中变量名与 profile 一致、Key 有效、Provider URL 可访问 |
| 提示未绑定 | 在业务仓根目录运行 `orch workspace "$PWD"` |
| 提示不是 Git root | 在业务仓执行 `git init`，不要绑定仓库子目录 |
| Codex 看不到 Skills/MCP | 重新运行 `bash scripts/install.sh`，再重启 Codex CLI |
| Plan 契约被修改 | 保持 Run 暂停；恢复批准版本，或创建新 Plan 重新批准 |
| OpenCode idle | 查看 `orch run status` 和 Phase 报告；不能据此标记 completed |
| OpenCode 会话卡死且没有人工门禁 | `orch run replace-session --run <runId>`，保留 Run/Phase/文件状态并新建 executor session |
| 需要验证码 | 保持原会话，走 `needs_user` / 一次性回复；不要 rework |

## 开发与测试

```bash
npm --prefix packages/bridge ci
npm --prefix packages/bridge run check
bash scripts/safety-smoke.sh
bash scripts/e2e-v2-mock.sh
npm --prefix packages/bridge audit --omit=dev
```

贡献前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。完整用户手册和 CLI 参考：[`docs/USAGE.md`](docs/USAGE.md) · [`docs/ORCH.md`](docs/ORCH.md) · [`docs/V2_DESIGN.md`](docs/V2_DESIGN.md)。

## 开源许可

本项目采用 [MIT License](LICENSE)。你可以使用、复制、修改和分发，但需保留许可证和版权声明。
