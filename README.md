# Codex ↔ OpenCode Orchestrator

Control plane for **Codex App (brain)** + **OpenCode (hands)**.

## What this is

1. You finalize a plan in Codex App → `plans/current.md`
2. `$opencode-dispatch` / `/dispatch` asks MCP bridge to start a run
3. Supervise with `/status` `/progress` `/interrupt` `/rework`
4. `/review` verifies against the plan

## Quick start

```bash
cd ~/Desktop/codex-opencode-orchestrator
cp .env.example .env
# Edit .env — set SILICONFLOW_API_KEY

# Bridge deps
cd packages/bridge && npm install && npm run build && cd ../..

# Optional: install OpenCode
bash scripts/setup-opencode.sh

# Smoke test (mock executor)
bash scripts/smoke-dispatch.sh
```

### Codex App

1. Open this folder as a trusted project in Codex App
2. MCP is declared in [`.codex/config.toml`](.codex/config.toml)
3. Use slash commands listed in [`AGENTS.md`](AGENTS.md)

### Switch executor

- Dev / control-plane only: `default_executor: mock` in `config/orchestrator.yaml`
- Real OpenCode: `default_executor: siliconflow-opencode` (needs OpenCode serve + SiliconFlow key)

## Security

- Never commit `.env`
- If a key was pasted in chat, rotate it in the SiliconFlow console
- Destructive shell / mass delete stay behind confirmation gates

## Layout

See plan: Skills under `.agents/skills/`, bridge under `packages/bridge/`, state under `plans/` `briefs/` `runs/`.

## Remote SSH (phase 2)

`config/orchestrator.yaml` reserves `ssh_remote` for `ymy@162.105.87.147`. Not implemented in v1.
