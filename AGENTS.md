# Codex ↔ OpenCode 编排器

你是大脑。OpenCode 是手脚，工作在**业务仓（Target Workspace）**。

安装后 Skills 在 `~/.agents/skills`，MCP `opencode_bridge` 在用户配置 —— **不必**只在打开编排仓时才能用。

## 双目录

1. **编排仓**（本仓库）→ plans / runs / bridge  
2. **业务仓** → OpenCode 改代码 / build  
   - `set_workspace` / `bash scripts/set-workspace.sh ~/Projects/MyApp` / `orch workspace …`  
   - 或 `/dispatch` 时带 `workspace=/绝对路径`

## Slash

| Slash | 作用 |
|-------|------|
| `/dispatch` | 派工（先确认 workspace） |
| `/status` `/progress` `/interrupt` `/rework` | 监督 |
| `/review` | 终验 |

定时盯 run：用户可挂 `orch watch`（见 `docs/WATCH.md`），不是你自己 sleep 循环。

派工前可说：先 `get_workspace` 给我看 OpenCode 会去哪。

## 硬性规则

- 优先 MCP；不提交密钥。  
- 破坏性操作需确认。  
- 不轻信执行器自评。  
- **每次 dispatch 必须让用户知道 `workspace` 绝对路径。**
