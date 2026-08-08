import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { approvePlan } from "../src/v2/plan.js";
import { startRunV2, statusV2 } from "../src/v2/service.js";
import { planFixture, tempWorkspace } from "./helpers.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("executor MCP exposes only reporting tools and is pinned to the bound workspace", async () => {
  const workspace = tempWorkspace();
  const planPath = planFixture(workspace);
  approvePlan(planPath);
  const oldTarget = process.env.ORCHESTRATOR_TARGET_WORKSPACE;
  process.env.ORCHESTRATOR_TARGET_WORKSPACE = workspace;
  const started = startRunV2({ planPath, executorId: "mock" }) as { run: { id: string } };
  if (oldTarget === undefined) delete process.env.ORCHESTRATOR_TARGET_WORKSPACE;
  else process.env.ORCHESTRATOR_TARGET_WORKSPACE = oldTarget;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, "dist/executor-index.js")],
    cwd: packageRoot,
    env: { ...process.env, ORCHESTRATOR_TARGET_WORKSPACE: workspace } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "executor-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["phase_report", "phase_start", "wait_for_human_reply"]);
    assert.equal(listed.tools.some((tool) => tool.name.includes("review") || tool.name.includes("complete")), false);

    const escaped = await client.callTool({
      name: "phase_start",
      arguments: { workspace: path.dirname(workspace), runId: started.run.id, phaseId: "P01" },
    });
    assert.equal(escaped.isError, true);
    assert.match(String((escaped.content[0] as { text?: string }).text), /executor_workspace_not_bound/);

    const common = { workspace, runId: started.run.id, phaseId: "P01" };
    const began = await client.callTool({ name: "phase_start", arguments: common });
    assert.equal(began.isError, undefined);
    const reported = await client.callTool({
      name: "phase_report",
      arguments: { ...common, outcome: "complete", comment: "reported through narrow MCP" },
    });
    assert.equal(reported.isError, undefined);

    process.env.ORCHESTRATOR_TARGET_WORKSPACE = workspace;
    const current = statusV2({ runId: started.run.id }) as { phases: Array<{ id: string; status: string }> };
    assert.equal(current.phases.find((phase) => phase.id === "P01")?.status, "implemented");
  } finally {
    if (oldTarget === undefined) delete process.env.ORCHESTRATOR_TARGET_WORKSPACE;
    else process.env.ORCHESTRATOR_TARGET_WORKSPACE = oldTarget;
    await client.close();
  }
});
