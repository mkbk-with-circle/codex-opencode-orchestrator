import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertInsideBound, setUserTargetWorkspace } from "../src/workspace.js";
import { tempWorkspace } from "./helpers.js";

test("set_workspace updates absent in-process binding immediately", () => {
  const previousHome = process.env.HOME;
  const previousTarget = process.env.TARGET_WORKSPACE;
  const previousOrchTarget = process.env.ORCHESTRATOR_TARGET_WORKSPACE;
  const home = tempWorkspace();
  const target = tempWorkspace();
  process.env.HOME = home;
  delete process.env.TARGET_WORKSPACE;
  delete process.env.ORCHESTRATOR_TARGET_WORKSPACE;
  try {
    setUserTargetWorkspace(target);
    assert.equal(process.env.TARGET_WORKSPACE, target);
    assert.equal(process.env.ORCHESTRATOR_TARGET_WORKSPACE, target);
  } finally {
    process.env.HOME = previousHome;
    if (previousTarget === undefined) delete process.env.TARGET_WORKSPACE;
    else process.env.TARGET_WORKSPACE = previousTarget;
    if (previousOrchTarget === undefined) delete process.env.ORCHESTRATOR_TARGET_WORKSPACE;
    else process.env.ORCHESTRATOR_TARGET_WORKSPACE = previousOrchTarget;
  }
});

test("set_workspace does not overwrite explicit caller environment", () => {
  const previousHome = process.env.HOME;
  const previousTarget = process.env.TARGET_WORKSPACE;
  const previousOrchTarget = process.env.ORCHESTRATOR_TARGET_WORKSPACE;
  const home = tempWorkspace();
  const explicit = tempWorkspace();
  const requested = tempWorkspace();
  process.env.HOME = home;
  process.env.TARGET_WORKSPACE = explicit;
  process.env.ORCHESTRATOR_TARGET_WORKSPACE = explicit;
  try {
    setUserTargetWorkspace(requested);
    assert.equal(process.env.TARGET_WORKSPACE, explicit);
    assert.equal(process.env.ORCHESTRATOR_TARGET_WORKSPACE, explicit);
  } finally {
    process.env.HOME = previousHome;
    if (previousTarget === undefined) delete process.env.TARGET_WORKSPACE;
    else process.env.TARGET_WORKSPACE = previousTarget;
    if (previousOrchTarget === undefined) delete process.env.ORCHESTRATOR_TARGET_WORKSPACE;
    else process.env.ORCHESTRATOR_TARGET_WORKSPACE = previousOrchTarget;
  }
});

test("bound paths cannot escape through a symlink", () => {
  const workspace = tempWorkspace();
  const outside = tempWorkspace();
  const runs = path.join(workspace, ".orchestrator", "runs");
  fs.symlinkSync(outside, runs, "dir");
  assert.throws(
    () => assertInsideBound(path.join(runs, "run-1", "state.json"), { absPath: workspace }, "runsDir"),
    /符号链接逃逸/,
  );
});
