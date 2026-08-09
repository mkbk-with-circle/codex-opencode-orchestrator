# Codex ↔ OpenCode Orchestrator

让 **Codex 做大脑**，让 **OpenCode 做执行 Harness**。

- Codex：和用户澄清需求、冻结 Plan、逐 Phase 审查、处理失败、决定最终完成。
- OpenCode：只实现当前被授权的 Phase，修改文件、执行命令、构建和测试。
- Orchestrator：保存状态、限制顺序、传递报告、恢复会话；它不替 Codex 做语义判断。

默认是严格串行：OpenCode 完成 P01 → Codex 验收 P01 → 才开放 P02。第一版不让多个 OpenCode 会话并行写同一仓库。

## 5 分钟上手

要求：macOS/Linux、Node.js 18+、Git、Codex CLI。

```bash
git clone https://github.com/mkbk-with-circle/codex-opencode-orchestrator.git
cd codex-opencode-orchestrator
bash scripts/install.sh
orch doctor
```

如果还没有 OpenCode：

```bash
bash scripts/setup-opencode.sh
```

脚本默认从 OpenCode 官方 GitHub Release 下载。自动化或生产安装建议同时固定版本与 SHA-256；使用镜像必须显式设置下载地址：

```bash
OPENCODE_VERSION=v1.18.3 \
OPENCODE_SHA256=<官方归档的 sha256> \
bash scripts/setup-opencode.sh

# 仅在确实需要镜像时：
OPENCODE_DOWNLOAD_URL=https://mirror.example/opencode.zip bash scripts/setup-opencode.sh
```

安装在自定义位置时，设置一次：

```bash
export OPENCODE_BIN=/absolute/path/to/opencode
```

### 1. 配好 OpenCode 模型

已有内置 profile 时：

```bash
orch model list
orch model check ikuncode-haiku
orch model use ikuncode-haiku
```

接入新的 OpenAI-compatible provider，只需一条注册命令：

```bash
orch model add \
  --name my-fast-model \
  --model my-provider/model-id \
  --base-url https://api.example.com/v1 \
  --api-key-env MY_PROVIDER_API_KEY \
  --activate
```

把真实 Key 写进本仓 `.env` 或 `~/.config/codex-opencode-orchestrator/secrets.env`：

```bash
MY_PROVIDER_API_KEY=...
```

再执行 `orch model check my-fast-model`。配置只保存环境变量名，命令不接收也不打印真实 Key。Codex 的模型仍用 Codex CLI 自己的模型切换，不由本项目包一层。

### 2. 绑定业务仓

v2 Run 要求目标目录是 Git 根目录：

```bash
cd ~/Projects/YourApp
git init                         # 已经是 Git 仓库时跳过
orch workspace "$PWD"
orch                            # 在这个工作区启动 Codex
```

Plan、状态和证据分别位于：

```text
.orchestrator/plans/            可审阅、可纳入版本控制的 Plan
.orchestrator/runs/             本地 Run 状态、事件和证据（忽略提交）
.orchestrator/needs-user.md      当前人工门禁（忽略提交）
```

### 3. 在 Codex 中执行

在对话中使用 `$opencode-*`，不要把 Codex 内置 `/plan` 当成本项目 Plan：

```text
$opencode-plan       和用户写多阶段 Plan
$opencode-dispatch   批准后派发当前 Phase
$opencode-supervise  查看 Run/Phase 状态
$opencode-review     独立验收并 accept / rework / needs_user
$opencode-poll       启动事件 supervisor
```

完整生命周期：

```text
draft Plan → 用户检查 → validate → approve
→ start Run → dispatch 当前窗口
→ OpenCode 报告 implemented / failed / blocked
→ Codex 独立审查 → 下一 Phase
→ 全部 accepted + 总体验收 → completed
```

`- [x]` 只表示 OpenCode 声明“已实现”，不表示审查通过。只有 Codex 能接受 Phase 和完成 Run。

## Plan 应该长什么样

从 [`plans/_TEMPLATE.md`](plans/_TEMPLATE.md) 开始。每个 Plan 必须包含：

- 整个项目持续生效的硬性规定；
- 稳定 Phase ID（P01、P02……）、依赖、允许路径；
- 可复现的验收标准/命令；
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

## OpenCode 是怎样接入的

派工会自动启动或复用仅监听 loopback 的 OpenCode HTTP Server；自动启动时会生成本机 `0600` 认证文件，并为其提供专用 `orchestrator_reporter` MCP。这个 MCP 只暴露：

- `phase_start`
- `phase_report`
- `wait_for_human_reply`

Codex 的 `review_phase`、`retry_phase`、`complete_run_v2` 不会暴露给 OpenCode。每次派工还会探测 `/mcp` 状态并自动修复失效的 reporter，无需用户手工重启 server。OpenCode 被禁止访问业务工作区以外的路径。

这是清晰的职责和权限分层，不是操作系统级安全沙箱；不可信代码仍应放进容器或独立系统账号运行。

## 密码、验证码与保持现场

不要把账号、密码、Cookie、Token 或验证码写进 Plan、brief、源码、Git 或普通日志。

执行器遇到登录/OTP 时会：

1. 用 `phase_report(outcome=blocked, keepAlive=true, holdKind=credentials|otp)` 暂停当前 Phase；
2. 保持同一个 OpenCode session、浏览器或 CLI 现场；
3. 在同一 attempt 内调用 `wait_for_human_reply`；
4. Codex 向用户提问；用户在自己的终端运行 `orch run reply --run <runId>`，通过无回显提示投递；
5. 执行器收到后继续原现场，不重新开始登录。

敏感回复按 `run + phase + attempt + waitToken` 绑定，写入 `0600` 的一次性文件，也不会进入 shell 参数或事件 payload。Reporter 只把不透明文件路径交给 OpenCode，不把秘密正文写入模型消息；执行程序必须直接消费该文件并立即删除，禁止 OpenCode 用 `read`/`cat` 查看。秘密仍会在目标程序使用它的那一刻进入本机进程内存；高安全场景建议由用户在受控终端/浏览器中亲自输入。

## 自动监督与恢复

```bash
orch watch start --run <runId> --session <专用Codex会话ID> --interval 60
orch watch status
orch watch stop
```

Supervisor 消费追加式 `events.jsonl` 和持久化 cursor。只有出现 implemented、failed、blocked 或协议违规事件才唤醒专用 Codex 会话；重启后从上次确认位置继续。`idle` 永远不等于完成。

## 升级旧 Plan

迁移默认生成新文件，不覆盖原 Plan：

```bash
orch plan migrate --plan legacy.md
```

需要原位迁移时用 `--in-place`，工具会先建立带时间戳的 `.v1.bak.*`。迁移结果始终保持 draft，必须由用户复核后才能批准。

## 自检与排错

```bash
orch doctor
npm --prefix packages/bridge run check
bash scripts/e2e-v2-mock.sh
```

| 现象 | 处理 |
|---|---|
| `opencode` 找不到 | 运行 `scripts/setup-opencode.sh`，或设置 `OPENCODE_BIN` |
| 模型不可用 | `orch model check <profile>`，确认对应环境变量已加载 |
| 提示未绑定 | 在业务仓运行 `orch workspace "$PWD"` |
| 提示不是 Git root | 在业务仓 `git init`，不要绑定仓库子目录 |
| Plan 契约被修改 | 保持 Run 暂停；恢复批准版本，或创建新 Plan 重新批准 |
| OpenCode idle | 查 `orch run status` 和 Phase 报告；不能据此标 completed |
| OpenCode 会话卡死且没有人工门禁 | `orch run replace-session --run <runId>`；保留 Run/Phase/文件状态并新建 executor session |
| 需要验证码 | 保持原会话，走 `needs_user` / 一次性回复；不要 rework |

更多资料：[`docs/USAGE.md`](docs/USAGE.md) · [`docs/ORCH.md`](docs/ORCH.md) · [`docs/V2_DESIGN.md`](docs/V2_DESIGN.md) · [`config/README.md`](config/README.md)
