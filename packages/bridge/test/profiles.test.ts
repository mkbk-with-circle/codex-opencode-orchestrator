import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { checkOpenCodeProfile, configureOpenCodeProfile, loadProfiles } from "../src/profiles.js";
import { tempWorkspace } from "./helpers.js";

test("quick model setup registers provider and profile without storing a secret", () => {
  const root = tempWorkspace();
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "opencode.json"), "{}\n");
  fs.writeFileSync(path.join(root, "config", "profiles.yaml"), "profiles: {}\n");
  const previousRoot = process.env.ORCHESTRATOR_ROOT;
  const previousKey = process.env.EXAMPLE_API_KEY;
  process.env.ORCHESTRATOR_ROOT = root;
  delete process.env.EXAMPLE_API_KEY;
  try {
    const configured = configureOpenCodeProfile({
      name: "example-fast",
      model: "example/model-v1",
      baseUrl: "https://example.invalid/v1",
      apiKeyEnv: "EXAMPLE_API_KEY",
      activate: true,
    }) as { apiKeyConfigured: boolean };
    assert.equal(configured.apiKeyConfigured, false);
    const raw = fs.readFileSync(path.join(root, "opencode.json"), "utf8");
    assert.match(raw, /\{env:EXAMPLE_API_KEY\}/);
    assert.doesNotMatch(raw, /secret-value/);
    assert.equal(loadProfiles(root).profiles["example-fast"].model, "example/model-v1");
    assert.equal((checkOpenCodeProfile("example-fast") as { ok: boolean }).ok, false);
    process.env.EXAMPLE_API_KEY = "secret-value";
    assert.equal((checkOpenCodeProfile("example-fast") as { ok: boolean }).ok, true);
  } finally {
    if (previousRoot === undefined) delete process.env.ORCHESTRATOR_ROOT;
    else process.env.ORCHESTRATOR_ROOT = previousRoot;
    if (previousKey === undefined) delete process.env.EXAMPLE_API_KEY;
    else process.env.EXAMPLE_API_KEY = previousKey;
  }
});
