# Codex ↔ OpenCode Orchestrator

You are the **brain** in this repo. OpenCode (via MCP `opencode-bridge`) is the **hands**.

## Slash commands (map to skills)

| Slash | Skill | Action |
|-------|--------|--------|
| `/dispatch` | `$opencode-dispatch` | Turn `plans/current.md` into a brief and start an executor run |
| `/status` | `$opencode-supervise` | Show current run status / todo / diff summary |
| `/interrupt` | `$opencode-supervise` | Abort the active OpenCode (or mock) session |
| `/rework` | `$opencode-supervise` | Abort + re-dispatch with updated instructions |
| `/progress` | `$opencode-supervise` | Ask executor for a short progress update |
| `/review` | `$opencode-review` | Verify result against the original plan |

## Workflow

1. Agree a plan with the user; write it to `plans/current.md` (self-contained, with acceptance checks).
2. Call MCP `dispatch` (or `$opencode-dispatch`). Default config requires confirming the brief before start (`confirm_before_dispatch: true`).
3. Supervise with `status` / `progress` / `interrupt` / `rework`.
4. Finish with `$opencode-review`: compare plan vs diff, run configured test commands, output PASS/FAIL.

## Hard rules

- Prefer MCP tools from `opencode-bridge`; do not raw-curl OpenCode unless MCP is down.
- Never commit secrets (`.env`, API keys).
- Gates: destructive shell and mass deletes require explicit user confirmation (see `config/orchestrator.yaml`).
- Do not trust the executor's self-report — re-check diffs and tests yourself.
- Keep execution scoped to the brief; reject drive-by refactors.

## Paths

- Plans: `plans/`
- Briefs: `briefs/`
- Runs: `runs/<runId>/state.json`
- Playground (demo target): `playground/`
