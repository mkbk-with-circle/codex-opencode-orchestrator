# Codex ↔ OpenCode Orchestrator v2 技术设计

## 1. 定位

本项目是一个 CLI-first 的双代理工程编排器：

- **Codex 是大脑**：与用户澄清需求、生成并批准 Plan、决定下一步、审查实现、处理失败和最终验收。
- **OpenCode 是 Harness**：在被授权的工作目录内修改文件、执行命令、构建和测试，并提交阶段执行报告。
- **orchestrator 是控制面**：保存契约和状态、限制可执行阶段、转发消息、记录事件、恢复现场，但不代替 Codex 做语义决策。

v2 的重点不是让两个模型自由对话，而是建立一个可恢复、可审计、不可跳阶段的执行协议。

## 2. 设计原则

1. **Plan 是任务契约**：目标、范围、硬性规定、Phase 定义和验收标准必须由 Codex 与用户确认。
2. **Markdown 面向人，结构化状态面向机器**：用户始终可以阅读 Plan；调度和恢复不能依赖模糊的 Markdown 文本推断。
3. **OpenCode 只报告执行结果**：不得改变需求、硬性规定、Phase 顺序或验收标准。
4. **声明完成不等于验收通过**：OpenCode 的完成勾选是 `implemented` 信号，只有 Codex 可以把 Phase 变成 `accepted`。
5. **默认严格串行**：批量执行必须由用户显式启用；v2 第一阶段不允许多个 OpenCode 会话并行写同一工作区。
6. **所有动作可重放、可恢复、可审计**：关键状态变化写入事件日志，并带稳定 ID、attempt 和时间戳。
7. **人类门禁优先**：需要凭据、验证码或产品决策时立即暂停，不猜测、不重启仍有效的交互现场。

## 3. 边界与非目标

### 3.1 v2 范围

- macOS/Linux 无图形界面的 Codex CLI 工作流。
- 本地业务仓和本地 OpenCode Server。
- 严格串行与有限批量两种调度模式。
- Phase 级执行、报告、审查、返工和用户门禁。
- 进程退出后的恢复、幂等事件消费和基础审计。

### 3.2 首版非目标

- 多个 OpenCode 会话同时修改同一工作区。
- 分布式队列、远程多机执行和云端控制面。
- 自动推送远程 Git 或自动创建 PR。
- 用编排器自身的规则代替 Codex 做语义验收。

## 4. 总体架构

```text
User
  │
  ▼
orch CLI ──────────────── Codex CLI
  │                         │
  │                         ├─ Plan drafting / approval
  │                         ├─ Phase review / decisions
  │                         └─ Final acceptance
  │
  ├─ Plan compiler and integrity guard
  ├─ Scheduler and phase state machine
  ├─ Event journal and locks
  ├─ Supervisor / watcher
  └─ OpenCode adapter ───── OpenCode Server ───── Business workspace
```

建议把控制面拆成以下模块：

- `plan/`：schema、解析、渲染、冻结、完整性校验和版本迁移。
- `state/`：Run/Phase 状态、原子写入、锁、事件日志和游标。
- `scheduler/`：计算当前允许执行的 Phase 窗口。
- `executor/`：OpenCode 会话生命周期和 phase-scoped brief。
- `review/`：为 Codex 构造阶段审查上下文并应用审查结论。
- `supervisor/`：消费事件、唤醒专用 Codex 会话、重试和暂停。
- `cli/`：稳定的人类及执行器命令接口。

## 5. 工作区布局

```text
<workspace>/.orchestrator/
  plans/<task>.md                 # 人类可读的 Plan 投影
  plans/<task>.lock.json          # 批准信息、schemaVersion、不可变区哈希
  runs/<runId>/state.json         # 当前 Run 与各 Phase 状态
  runs/<runId>/events.jsonl       # 追加式事件日志
  runs/<runId>/review-cursor.json # Codex supervisor 已处理到的位置
  runs/<runId>/artifacts/         # diff、命令输出、验收证据
  runs/<runId>/lock               # 单实例互斥锁
  needs-user.md
  hold.json
  user-reply.md
```

Plan 是需求和进度的用户界面；`state.json + events.jsonl` 是调度器的机器事实来源。每次状态变化后由 renderer 原子更新 Plan 中的勾选和受控报告块。

## 6. Plan v2 协议

### 6.1 元数据

Plan frontmatter 至少包含：

```yaml
schemaVersion: 2
planId: stable-uuid
task: task-slug
workspace: /absolute/path
status: draft | approved | running | paused | completed | cancelled
executionMode: strict | batch
batchSize: 1
approvedAt: null
specHash: null
```

`approved` 之后，目标、范围、非范围、硬性规定、Phase ID/顺序/依赖和验收条件纳入 `specHash`。改变这些内容必须由 Codex 创建新版本并再次获得用户批准。

### 6.2 Phase 结构

每个 Phase 必须拥有稳定 ID，例如 `P01`，并包含：

- 标题和目的。
- 前置依赖。
- 允许修改的路径。
- 明确交付物。
- 阶段验收标准和命令。
- OpenCode 报告区。
- Codex 审查区。

唯一的 GitHub checkbox 表示 OpenCode 是否声明实现完成：

- `- [ ]`：尚未声明完成，可能是 pending、running、blocked、attempt_failed 或 review_failed。
- `- [x]`：OpenCode 已提交 implemented 报告，等待或已经通过 Codex 审查。

如果 Codex 审查失败，renderer 将复选框恢复为 `- [ ]`，状态变为 `review_failed`，保留旧 attempt 和审查意见。

### 6.3 写权限

Plan 划分为三种所有权区域：

- `codex-user-owned`：需求契约，OpenCode 不得修改。
- `executor-report`：OpenCode 可通过受控命令追加报告。
- `codex-review`：只有 Codex 审查流程可以写。

OpenCode 不直接编辑 Plan，而是调用控制面：

```bash
orch phase start P01
orch phase complete P01 --comment <text> --evidence-file <path>
orch phase fail P01 --comment <text>
orch phase block P01 --need-user <text> --keep-alive
```

控制面在写入前验证 `specHash`、当前状态、Phase 是否位于授权窗口以及事件是否重复。发现越权修改时产生 `protocol_violation` 并暂停 Run。

## 7. 状态机

### 7.1 Run 状态

```text
draft → approved → running ↔ paused → awaiting_final_review → completed
                         └────────────→ failed / cancelled
```

### 7.2 Phase 状态

```text
pending → ready → running → implemented → reviewing → accepted
                    │             │             └→ review_failed → ready
                    ├→ blocked ───┘
                    └→ attempt_failed → ready
```

规则：

- 只有 scheduler 能把 `pending` 变为 `ready`。
- 只有处于授权窗口的 Phase 能进入 `running`。
- OpenCode 可以提交 `implemented`、`blocked`、`attempt_failed`。
- 只有 Codex 可以提交 `accepted` 或 `review_failed`。
- 所有 Phase 都是 `accepted` 且总体验收通过后，Run 才能 `completed`。

## 8. 调度模式

### 8.1 strict（默认）

- 授权窗口始终只有一个 Phase。
- OpenCode 提交 `implemented` 后立即停止执行。
- Codex 审查通过后才开放下一 Phase。
- 审查失败则只返工当前 Phase。

### 8.2 batch

- 用户明确设置 `batchSize=N`。
- scheduler 最多开放 N 个连续且依赖已满足的 Phase。
- OpenCode 仍须按顺序逐个报告，不能最后一次性勾选。
- 任一 Phase `blocked`、`attempt_failed` 或 `review_failed` 后，批次停止。
- 首版 batch 仍使用一个 OpenCode 会话，不做并行文件写入。

## 9. OpenCode 执行协议

每次派工只发送：

- 全局目标、范围和硬性规定。
- 当前授权窗口内的 Phase。
- 允许修改路径。
- 验收条件。
- 报告命令和停止条件。

不再把所有未完成 Phase 一次性作为可执行任务暴露给 OpenCode。OpenCode 完成一个 Phase 后必须先保存证据，再调用报告接口。证据至少包含：

- 变更文件列表或 diff artifact。
- 执行过的构建/测试命令。
- 退出码和必要的输出摘要。
- 未验证事项与风险。

## 10. Codex 审查协议

Watcher 收到 `phase.implemented` 后，使用专用 supervisor Codex 会话审查该 Phase。审查上下文只包含：

- 冻结的 Plan 契约和当前 Phase。
- 基线与当前 diff。
- OpenCode 报告和 artifacts。
- 验收命令输出。
- 前置 Phase 的已接受结论。

Codex 必须返回结构化结论：

```json
{
  "verdict": "accept | rework | needs_user",
  "phaseId": "P01",
  "summary": "...",
  "evidence": ["..."],
  "gaps": ["..."],
  "nextInstruction": "..."
}
```

- `accept`：Phase 变为 `accepted`，scheduler 计算下一窗口。
- `rework`：复选框恢复未完成，attempt 增加，并在同一 OpenCode 会话继续；除非会话已经死亡，否则不新建会话。
- `needs_user`：打开人工门禁并暂停 Run。

最终 `mark_complete` 必须同时满足：所有 Phase 为 `accepted`、没有 open hold、总体验收命令通过、Plan 完整性校验通过。

## 11. 事件与轮询

关键事件写入追加式 `events.jsonl`：

```json
{"eventId":"uuid","seq":12,"type":"phase.implemented","runId":"...","phaseId":"P01","attempt":1,"at":"..."}
```

至少支持：

- `run.started`, `run.paused`, `run.resumed`, `run.completed`
- `phase.started`, `phase.implemented`, `phase.blocked`, `phase.attempt_failed`
- `review.accepted`, `review.rework`, `review.needs_user`
- `human.reply_provided`
- `protocol.violation`

Watcher 按 `seq` 和持久化 cursor 消费事件，而不是根据文件 mtime 推断业务状态。定时器只负责唤醒 watcher；事件日志决定具体动作。

为避免同时恢复同一个 Codex 会话，自动监督使用独立 supervisor session，并通过 run lock 串行消费事件。交互式规划会话不由后台进程并发 resume。

## 12. 人工门禁

保留现有 `needs-user.md + hold.json + user-reply.md` 思路，但将 hold 关联到 `runId + phaseId + attempt + waitToken`。

- `keepAlive=true`：保持当前 OpenCode 会话及浏览器/CLI/SSH 现场，仅通过 `provide-reply` 和同会话 resume 恢复。
- `keepAlive=false`：可以安全退出执行器，用户回复后重新调度当前 Phase。
- secret 默认只进入受权限保护的临时文件或进程环境，不进入 Plan、事件日志、brief、Git 和普通命令输出。

## 13. CLI 草案

```text
orch init
orch workspace [path]
orch plan create <task>
orch plan validate <task>
orch plan approve <task>
orch run <task> [--mode strict|batch] [--batch-size N]
orch run status [runId]
orch run pause|resume|cancel [runId]
orch phase status [phaseId]
orch phase start|complete|fail|block ...
orch review [runId] [--phase P01]
orch watch start|stop|status
orch run reply --run <runId>  # 终端无回显输入
orch doctor
```

面向 OpenCode 的 `phase` 写命令可以隐藏在专用 MCP tools 中，避免用户命令和执行器命令混淆。

## 14. 安全、可靠性与兼容性

- 所有状态文件使用临时文件加 rename 的原子写入。
- 每个 Run 使用文件锁，锁中记录 PID、host、startedAt，并支持过期锁恢复。
- HTTP 请求必须有 timeout、重试上限和错误分类。
- 启动时检查 Codex CLI/OpenCode 版本及必要 API capability。
- 默认禁止 OpenCode push、修改 Git remote、写工作区外路径和执行大范围删除。
- 派工前记录 Git 基线；每 Phase 保存 diff，检测超出允许路径的变更。
- 事件和命令输出必须脱敏；秘密文件权限使用 `0600`。
- v1 Plan 通过迁移器转成 schema v2；迁移前保留备份，不静默覆盖。

## 15. 测试策略

测试分四层：

- 单元测试：Plan parser/renderer、hash、状态机、scheduler、事件幂等。
- 集成测试：mock executor 的 strict/batch、返工、阻塞、进程重启恢复。
- 合约测试：固定 OpenCode 版本下的 Server API 请求和响应。
- E2E：临时 Git 仓中由 Codex supervisor + mock/OpenCode 完成多阶段任务并通过最终验收。

必须覆盖非法路径写入、Plan 越权修改、重复事件、过期锁、OpenCode 失联、Codex 审查失败、用户回复超时和进程崩溃恢复。

## 16. 迁移策略

1. 先加入 v2 schema、状态机和测试，不删除 v1 命令。
2. 让 v1 `dispatch/status/review` 内部适配到 v2 服务。
3. 引入受控 Phase 报告接口与 strict 调度。
4. 用事件 watcher 替换 mtime 业务判断，保留旧 poll 命令作为兼容入口。
5. 完成 E2E 后把 v2 设为默认，并在一个明确版本中移除 v1 兼容层。

## 17. 已确定的默认决策

- 默认执行模式：`strict`。
- 默认 `batchSize`：1。
- OpenCode 完成勾选必须逐 Phase 发生。
- Codex 必须逐 Phase 审查；批量模式不降低审查粒度。
- 首版不允许并行写同一业务仓。
- Plan 批准后冻结契约区；任何需求变化必须重新批准。
- 自动监督使用独立 Codex supervisor 会话。
- 最终完成权始终属于 Codex。
