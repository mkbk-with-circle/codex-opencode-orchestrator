#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

let input = {};
try { input = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(0); }

let workspace = process.env.ORCHESTRATOR_TARGET_WORKSPACE || process.env.TARGET_WORKSPACE;
if (!workspace) {
  try {
    const binding = fs.readFileSync(path.join(process.env.HOME, ".config", "codex-opencode-orchestrator", "workspace.env"), "utf8");
    workspace = binding.split(/\r?\n/).find((line) => line.startsWith("TARGET_WORKSPACE="))?.slice("TARGET_WORKSPACE=".length);
  } catch {}
}
if (!workspace) process.exit(0);
let root;
let cwd;
try {
  root = fs.realpathSync(workspace);
  cwd = fs.realpathSync(input.cwd || process.cwd());
} catch { process.exit(0); }
if (cwd !== root && !cwd.startsWith(`${root}${path.sep}`)) process.exit(0);

const tool = String(input.tool_name || "");
const command = String(input.tool_input?.command || "");
if (tool === "Bash" && /\borch\s+authority\s+(grant|allow)\b/.test(command)) {
  deny("Codex 不能自行解除执行隔离；请用户在独立终端运行 orch authority grant/allow。");
}

const policyFile = path.join(root, ".orchestrator", "authority-policy.json");
let persistent = false;
try { persistent = JSON.parse(fs.readFileSync(policyFile, "utf8")).defaultOwner === "codex"; } catch {}

let granted = persistent;
const runsDir = path.join(root, ".orchestrator", "runs");
try {
  const states = fs.readdirSync(runsDir)
    .map((id) => path.join(runsDir, id, "state.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")))
    .filter((run) => !["completed", "cancelled", "failed"].includes(run.status))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const authority = states[0]?.executionAuthority;
  if (authority?.owner === "codex") {
    granted = authority.kind === "persistent" || (authority.kind === "temporary" && Date.parse(authority.expiresAt || "") > Date.now());
  }
} catch {}
if (granted) process.exit(0);

if (tool === "apply_patch" || tool === "Edit" || tool === "Write") {
  deny("默认执行者是 OpenCode；Codex 只能规划和审查，不能直接修改业务仓。用户可在独立终端授予临时或长期权限。");
}
if (tool === "Bash") {
  const safe = /^\s*(pwd|ls|rg|grep|sed\s+-n|head|tail|wc|stat|git\s+(status|diff|log|show|rev-parse|ls-files))\b/.test(command);
  const shellSyntax = /[>;&|`\n]|\$\(/.test(command);
  if (!safe || shellSyntax) deny("Codex 在 OpenCode-only 模式只能运行简单只读检查；构建、测试和实施命令应通过编排验收工具或交给 OpenCode。");
}
if (!tool.startsWith("mcp__opencode_bridge__") && /(write|edit|delete|remove|move|create|upload|deploy)/i.test(tool)) {
  deny(`工具 ${tool} 可能产生写入；当前业务仓执行权属于 OpenCode。`);
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
  process.exit(0);
}
