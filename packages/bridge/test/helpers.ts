import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function tempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-v2-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(path.join(dir, ".gitkeep"), "");
  execFileSync("git", ["add", ".gitkeep"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "fixture"], { cwd: dir });
  fs.mkdirSync(path.join(dir, ".orchestrator", "plans"), { recursive: true });
  return dir;
}

export function planFixture(workspace: string, task = "fixture"): string {
  const file = path.join(workspace, ".orchestrator", "plans", `${task}.md`);
  fs.writeFileSync(
    file,
    `---
workspace: ${workspace}
task: ${task}
status: draft
executionMode: strict
batchSize: 1
---

# Fixture

## 目标
Build the fixture.

## 整个项目必须遵循的硬性规定

1. Never push.
2. Stay in the workspace.

## 步骤

- [ ] P01 — First phase
  - 允许修改：src/**
  - 验收：test -f src/one.txt
  <!-- OPENCODE REPORT P01 START -->
  status: pending
  comment:
  evidence:
  <!-- OPENCODE REPORT P01 END -->

- [ ] P02 — Second phase
  - 依赖：P01 accepted
  - 允许修改：src/**
  - 验收：test -f src/two.txt
  <!-- OPENCODE REPORT P02 START -->
  status: pending
  comment:
  evidence:
  <!-- OPENCODE REPORT P02 END -->
`,
  );
  return file;
}
