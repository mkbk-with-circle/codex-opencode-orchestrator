# 配置说明

OpenCode 商家与模型、编排切换名、密钥分三处配置，职责不重叠。

| 内容 | 文件 |
|------|------|
| 商家与模型列表 | 根目录 `opencode.json` |
| 切换用短名（profile） | `config/profiles.yaml` |
| API Key、OpenCode 地址 | `.env`（模板：`.env.example`） |
| 当前选用的 profile | `orch use <名>` → `config/active.local.yaml` |

`.env` 只放密钥与连接信息；`opencode.json` 只注册 provider/models（密钥用 `{env:…}`）；`profiles.yaml` 只做命名切换。

---

## 注册商家与模型

在 `opencode.json` 中增加 `provider` 块；同一商家下可在 `models` 中列出多个模型 id。

```json
{
  "provider": {
    "ikuncode": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.ikuncode.cc/v1",
        "apiKey": "{env:IKUNCODE_API_KEY}"
      },
      "models": {
        "claude-haiku-4-5-20251001": {},
        "claude-sonnet-4-5-20250929": {}
      }
    },
    "siliconflow": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.siliconflow.cn/v1",
        "apiKey": "{env:SILICONFLOW_API_KEY}"
      },
      "models": {
        "deepseek-ai/DeepSeek-V3": {}
      }
    }
  },
  "model": "ikuncode/claude-haiku-4-5-20251001"
}
```

最小示例见 [`examples/`](./examples/)。

---

## 定义与切换 profile

在 `config/profiles.yaml` 中为每个「商家 + 模型」命名：

```yaml
profiles:
  ikuncode-haiku:
    model: ikuncode/claude-haiku-4-5-20251001
  ikuncode-sonnet:
    model: ikuncode/claude-sonnet-4-5-20250929
  siliconflow-v3:
    model: siliconflow/deepseek-ai/DeepSeek-V3
```

```bash
orch use
orch use ikuncode-sonnet
orch use siliconflow-v3
```

同一 provider 下切换、且存在进行中的 OpenCode 会话时，会尽量在同一 session 上换模型并保留上下文。更换商家后，下一轮派工才使用新 API，旧会话上下文不保留。

---

## 各文件职责

| 文件 | 用途 | 不宜放入 |
|------|------|----------|
| `.env` | 密钥、`OPENCODE_BASE_URL` | 模型清单 |
| `opencode.json` | provider、baseURL、models | 明文密钥 |
| `config/profiles.yaml` | profile 名 → `provider/model` 或 `type: mock` | 密钥 |
| `config/orchestrator.yaml` | confirm、worktree、save_briefs 等编排行为 | 商家 Key |
| `config/active.local.yaml` | 当前 profile（本地，勿提交） | — |

业务仓运行时目录：`.orchestrator/plans|briefs|runs/`。

---

## 常见 baseURL

| 商家 | provider | baseURL | 环境变量 |
|------|----------|---------|----------|
| IKunCode | `ikuncode` | `https://api.ikuncode.cc/v1` | `IKUNCODE_API_KEY` |
| SiliconFlow | `siliconflow` | `https://api.siliconflow.cn/v1` | `SILICONFLOW_API_KEY` |
| OpenAI | `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| DeepSeek | `deepseek` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| Ollama | `ollama` | `http://127.0.0.1:11434/v1` | 任意非空占位 |

参考：[OpenCode Config](https://opencode.ai/docs/config/) · [Providers](https://opencode.ai/docs/providers/)
