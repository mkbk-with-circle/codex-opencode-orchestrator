import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { tempWorkspace } from "./helpers.js";

const guard = path.resolve("../../scripts/codex-execution-guard.mjs");

function invoke(workspace: string, tool_name: string, command = "") {
  return spawnSync(process.execPath, [guard], {
    input: JSON.stringify({ cwd: workspace, tool_name, tool_input: { command } }),
    encoding: "utf8",
    env: { ...process.env, ORCHESTRATOR_TARGET_WORKSPACE: workspace },
  });
}

test("Codex guard blocks edits and implementation commands by default", () => {
  const workspace = tempWorkspace();
  assert.match(invoke(workspace, "apply_patch", "*** Begin Patch").stdout, /permissionDecision.*deny/);
  assert.match(invoke(workspace, "Bash", "npm test").stdout, /permissionDecision.*deny/);
  assert.equal(invoke(workspace, "Bash", "git status --short").stdout, "");
});

test("Codex guard honors persistent policy but never lets Codex self-grant", () => {
  const workspace = tempWorkspace();
  const dir = path.join(workspace, ".orchestrator");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "authority-policy.json"), JSON.stringify({ schemaVersion: 1, defaultOwner: "codex" }));
  assert.equal(invoke(workspace, "apply_patch", "*** Begin Patch").stdout, "");
  assert.match(invoke(workspace, "Bash", "orch authority allow --run x").stdout, /不能自行解除/);
});
