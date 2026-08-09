# Contributing

感谢你改进 Codex ↔ OpenCode Orchestrator。

## 本地开发

要求 Node.js 18+、npm、Git 和 Bash。Fork 并 clone 仓库后运行：

```bash
npm --prefix packages/bridge ci
npm --prefix packages/bridge run check
bash scripts/safety-smoke.sh
bash scripts/e2e-v2-mock.sh
```

如果要验证真实 OpenCode 调用，请使用自己的 Provider/API Key，并确保 `.env` 未被 Git 跟踪。普通单元测试和 mock E2E 不需要真实 API Key。

## 提交 Pull Request

1. 从最新 `main` 创建功能分支。
2. 每个 PR 聚焦一个问题，说明动机、行为变化和验证方式。
3. 为行为变化补充或更新测试、README 和相关文档。
4. 确保 TypeScript 检查、单元测试、安全 smoke 和 mock E2E 全部通过。
5. 不要提交 `.env`、API Key、Cookie、账号、验证码、业务仓运行数据或其他私人信息。

涉及 Plan 契约、Phase 状态机、权限边界或秘密传递的修改属于高风险变更，请在 PR 中明确列出兼容性和安全影响。

## 报告问题

提交 Issue 时请提供版本、操作系统、Node/Codex/OpenCode 版本、最小复现步骤和已脱敏的日志。请先删除访问令牌、绝对私人路径、账号和业务数据。
