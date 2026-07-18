# 定时轮询（Watch）

Codex CLI **不能**自己「每隔 N 秒醒一次」。要定时监督，用编排仓脚本或系统 cron。

## 推荐：`orch watch`

```bash
# 安装后
export PATH="/path/to/codex-opencode-orchestrator/bin:$PATH"

orch watch --interval 30
orch watch --run <runId> --until-done --interval 15
orch watch --ask-on-stall 180 --interval 45
orch watch --ask-on-change --interval 30
```

等价：

```bash
bash scripts/watch-run.sh --interval 30 --until-done
```

### 标志

| 标志 | 含义 |
|------|------|
| `--interval N` | 轮询间隔（秒） |
| `--run ID` | 指定 run；默认最新 |
| `--until-done` | completed/failed/… 后退出 |
| `--once` | 只查一次 |
| `--ask-on-change` | fingerprint 变化时 `codex exec` 监督 |
| `--ask-on-stall N` | N 秒无进展变化则唤醒 Codex |
| `--max N` | 最多轮询 N 次 |
| `--quiet` | 少打印 |

`--ask-*` 使用 `codex exec -C <编排仓> -s read-only`，让模型调 MCP 看 status，**不改业务代码**。

## 系统定时器示例（macOS launchd）

每 5 分钟检查一次（需自行改路径）：

```xml
<!-- ~/Library/LaunchAgents/com.coco.watch.plist 示意 -->
<key>ProgramArguments</key>
<array>
  <string>/bin/bash</string>
  <string>/ABS/codex-opencode-orchestrator/scripts/watch-run.sh</string>
  <string>--once</string>
  <string>--ask-on-stall</string>
  <string>300</string>
</array>
<key>StartInterval</key>
<integer>300</integer>
```

更简单：开一个终端挂着 `orch watch --until-done` 即可。
