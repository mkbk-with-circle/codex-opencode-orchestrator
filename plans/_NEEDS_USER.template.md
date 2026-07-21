---
status: open
kind: other
# kind: otp | credentials | decision | 2fa | captcha | device | cli | process | browser | secret | other
keepAlive: true
replyFile: .orchestrator/user-reply.md
waitToken: REPLACE_OR_USE_begin_user_hold
holdHint: "描述仍保持的现场：如 browser IAAA SMS / ssh sudo / cli confirm"
createdAt: REPLACE_ISO_TIME
runId: optional-run-id
---

# 需要用户提供

## 问题
一句话说明卡住的原因。

## 需要什么
- 例如：短信验证码；CLI 选项 `y/n`；设备上点批准后的确认；Cookie 路径

## 现场保持（keepAlive）
- 仍打开的是什么：浏览器页 / CLI / SSH / 进程 / 其它
- 执行端应：`wait-reply` 阻塞等待，**不要**关掉现场
- Codex 应：`provide_user_reply`（+ 必要时同会话 `resume`），**不要** `rework`

## 安全
不要把真实密钥写进本仓库已跟踪文件。
