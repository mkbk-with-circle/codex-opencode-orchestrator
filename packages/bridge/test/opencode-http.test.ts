import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { OpenCodeHttpExecutor } from "../src/adapters/opencode-http.js";
import type { RunState } from "../src/types.js";

test("OpenCode HTTP adapter follows the pinned server request contract", async () => {
  const requests: Array<{ method?: string; pathname: string; directory: string | null; body: string }> = [];
  let reporterReady = false;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push({ method: request.method, pathname: url.pathname, directory: url.searchParams.get("directory"), body });
      response.setHeader("content-type", "application/json");
      if (url.pathname === "/global/health") return response.end(JSON.stringify({ healthy: true, version: "test" }));
      if (url.pathname === "/mcp" && request.method === "GET") {
        return response.end(JSON.stringify({ orchestrator_reporter: { status: reporterReady ? "connected" : "failed" } }));
      }
      if (url.pathname === "/mcp" && request.method === "POST") {
        reporterReady = true;
        return response.end(JSON.stringify({ status: "connected" }));
      }
      if (request.method === "POST" && url.pathname === "/session") return response.end(JSON.stringify({ id: "session-1", directory: url.searchParams.get("directory") }));
      if (request.method === "POST" && url.pathname === "/session/session-1/prompt_async") { response.statusCode = 204; return response.end(); }
      if (url.pathname === "/session/status") return response.end(JSON.stringify({ "session-1": { type: "busy" } }));
      if (url.pathname.endsWith("/todo")) return response.end("[]");
      if (url.pathname.endsWith("/diff")) return response.end(JSON.stringify([{ path: "src/a.ts" }]));
      if (url.pathname.endsWith("/message")) return response.end(JSON.stringify([{ parts: [{ type: "text", text: "working" }] }]));
      if (url.pathname.endsWith("/abort")) { response.statusCode = 204; return response.end(); }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const options = { defaultBaseUrl: `http://127.0.0.1:${address.port}`, autoStartServe: false, model: "vendor/model-x" };
    const run: RunState = {
      id: "run-1", status: "running", executorId: "profile", executorType: "opencode-http",
      model: "vendor/model-x", planPath: "/tmp/plan.md", briefPath: "", workspace: "/tmp/business",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), promptSentAt: new Date().toISOString(),
    };
    const adapter = new OpenCodeHttpExecutor();
    const started = await adapter.start({ run, brief: "P01 only", workspace: run.workspace, options });
    assert.equal(started.sessionId, "session-1");
    run.sessionId = started.sessionId;
    const poll = await adapter.poll({ run, options });
    assert.equal(poll.activity, "busy");
    assert.equal(poll.diffSummary, "src/a.ts");
    assert.equal((await adapter.abort({ run, options })).ok, true);
    assert.equal(requests.every((request) => ["/global/health", "/mcp"].includes(request.pathname) || request.directory === run.workspace), true);
    const mcpSetup = requests.find((request) => request.method === "POST" && request.pathname === "/mcp");
    const mcpBody = JSON.parse(mcpSetup?.body || "{}");
    assert.equal(mcpBody.name, "orchestrator_reporter");
    assert.equal(mcpBody.config.timeout, 3_600_000);
    const prompt = requests.find((request) => request.pathname.endsWith("/prompt_async"));
    assert.deepEqual(JSON.parse(prompt?.body || "{}").model, { providerID: "vendor", modelID: "model-x" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("OpenCode HTTP poll reports an unreachable server as failed", async () => {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  const run: RunState = {
    id: "run-offline", status: "running", executorId: "profile", executorType: "opencode-http",
    model: "vendor/model-x", planPath: "/tmp/plan.md", briefPath: "", workspace: "/tmp/business",
    sessionId: "session-offline", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const poll = await new OpenCodeHttpExecutor().poll({ run, options: { defaultBaseUrl: url } });
  assert.equal(poll.activity, "failed");
  assert.equal(poll.status, "failed");
  assert.match(poll.summary || "", /opencode_http_unreachable/);
});
