# 工作目录怎么打通

先跑一次 `bash scripts/install.sh`（配置 Codex CLI / MCP / Skills）。

## 推荐用法

```text
Codex CLI：在任意目录（常用业务仓）启动
OpenCode：只在 TARGET_WORKSPACE（业务仓）里改代码 / build
编排仓：plans / runs / bridge；不必一直打开编排仓当 cwd
```

### 一次设定默认业务仓

```bash
bash scripts/set-workspace.sh ~/Projects/YourApp
# 或
orch workspace ~/Projects/YourApp
```

写入：`~/.config/codex-opencode-orchestrator/workspace.env`

### 或在 Codex 里

```text
把目标工作目录设为 /Users/你/Projects/YourApp
然后 /dispatch
```

或：

```text
/dispatch，workspace=/Users/你/Projects/YourApp
```

### Plan 里也可写（可选）

```markdown
---
workspace: /Users/你/Projects/YourApp
---
# 任务标题
...
```

## 优先级

1. `/dispatch` 的 `workspace` 参数  
2. plan 文首 `workspace:`  
3. 环境变量 `TARGET_WORKSPACE`  
4. 用户配置 `workspace.env`  
5. 编排仓默认 `playground`（仅演示）

外部绝对路径时：**不会**再套编排仓的 git worktree，OpenCode 直接进你的项目目录。

## 查看当前解析结果

```bash
orch workspace
# 或
cd packages/bridge && npx tsx src/cli.ts workspace
```

或 MCP：`get_workspace`。
