---
name: opencode-ask-user
description: >
  当执行需要账号、密码、Cookie、Token、验证码、2FA、设备确认、CLI 交互选择或其他
  只有用户能提供的信息时，立即停止推进并向用户提问。适用于 $opencode-ask-user、
  发现 needs-user / hold.json、登录态缺失、验收缺凭据、轮询唤醒后发现阻塞。
  凡 keepAlive 交互等待：保持同一 OpenCode 会话与现场，用 provide_user_reply / resume，禁止 rework。
---

# 向用户索取信息

## 何时触发

- plan / brief / OpenCode 进度提到需要登录、Cookie、Token、密码、验证码、2FA、设备确认、人工二选一  
- 存在 `{绑定仓}/.orchestrator/needs-user.md` 且 `status: open`，或存在 `hold.json` 且 status open  
- 你自己判断：没有用户回答就无法安全继续  

## 步骤

1. **立刻停止**：不要 `dispatch` / `rework` / `mark_complete`，不要猜凭据，不要继续改业务代码。  
2. **读** `.orchestrator/needs-user.md` 与（若有）`hold.json`，归纳缺什么、是否 `keepAlive`。  
3. **只向用户提问**，一次问清：

```text
需要你提供信息后才能继续：
- 缺什么：<验证码 / Cookie / 选项 / 设备确认结果 / …>
- 现场：<是否 keepAlive；浏览器/CLI/SSH/进程是否仍开着>
- 怎么给：粘贴到对话即可（不要提交进 git）
提供后我会写入 .orchestrator/user-reply.md 并恢复执行。
```

4. 用户回复后：按「恢复执行」处理。

## 通用协议（网页 + 非网页）

业务仓 `.orchestrator/`：

| 文件 | 作用 |
|------|------|
| `needs-user.md` | 向 Codex/人说明缺什么 |
| `hold.json` | 结构化门禁（`keepAlive`、`waitToken`、`holdHint`） |
| `user-reply.md` | 用户输入投递箱；`wait-reply` 轮询此文件 |

执行端（OpenCode）标准动作：

1. 建立/保持现场（浏览器页、CLI 提示符、SSH、设备流、REPL…）  
2. `begin_user_hold`（或手写同等 needs-user + hold）  
3. **阻塞** `wait_for_user_reply` / `orch wait-reply`（不要退出持有现场的进程）  
4. 读到回复后，在**同一现场**继续，禁止无故重启该步骤  

Codex（你）标准动作：

1. 问用户 → 收到答案  
2. v2 Run 使用 `provide_human_reply_v2`，它会校验 runId + phaseId + attempt、写入 `user-reply.md` 并重新授权原 Phase。
3. 若执行端未在 wait、只是 idle：再 `dispatch_window_v2` 向同一 session 发送当前窗口；执行端正在 wait 时文件投递会直接解锁。
4. **禁止** `rework` / 新 `dispatch` 来「投喂」答案（会毁掉 keepAlive 现场）
5. 对 credentials / otp / 2fa / secret，executor 只会收到一次性文件路径：禁止 `read` / `cat` / 打印文件；只能把路径交给获准的目标程序，由目标程序消费后立即删除。

## 恢复执行

### A. keepAlive = true（默认：有活现场）

适用：短信/OTP、网页登录、CLI 交互、sudo/SSH 确认、2FA、验证码、设备批准、流程中二选一等。

1. `provide_human_reply_v2`（`reply` = 用户原文，显式传 runId）
2. 必要时 `dispatch_window_v2`，但必须复用 state 中同一个 sessionId并说明禁止重启该交互
3. **不要** `interrupt` / `rework`

### B. keepAlive = false（仅静态凭据，无活现场）

适用：事先导出的 Cookie/Token/密钥文件，当前没有打开的登录页或交互进程。

1. 写入本机环境或本地忽略文件；`needs-user` → resolved  
2. 可用 `resume`；仅当原 run 已死且确认无现场时，才允许新 `dispatch`

## 注意

- 把真实密钥写进 plan、commit、公开日志  
- 未获回答就勾完 phase 或 `mark_complete`  
- 用 `rework`/新派工投喂 keepAlive 场景的用户输入  

## 与其它 skill

- supervise / poll 发现 needs-user → **先本 skill**  
- review 缺登录态 → 本 skill  
- keepAlive 恢复 → `provide_user_reply` + `resume`，不是 `rework`  
