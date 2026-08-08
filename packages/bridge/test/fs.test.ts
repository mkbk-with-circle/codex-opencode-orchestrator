import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { acquireLock, atomicWrite, releaseLock } from "../src/v2/fs.js";
import { tempWorkspace } from "./helpers.js";

test("atomicWrite replaces content without leaving temp files", () => {
  const dir = tempWorkspace();
  const file = path.join(dir, "state.json");
  atomicWrite(file, "one\n");
  atomicWrite(file, "two\n");
  assert.equal(fs.readFileSync(file, "utf8"), "two\n");
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes(".tmp")), []);
});

test("run lock rejects a live owner and recovers a stale lock", () => {
  const dir = tempWorkspace();
  const file = path.join(dir, "lock");
  const now = Date.now();
  const first = acquireLock(file, { now, staleMs: 100 });
  assert.throws(() => acquireLock(file, { now: now + 50, staleMs: 100 }), /run_locked/);
  fs.utimesSync(file, new Date(0), new Date(0));
  const recovered = acquireLock(file, { now: now + 200, staleMs: 100 });
  releaseLock(first);
  assert.equal(fs.existsSync(file), true);
  releaseLock(recovered);
  assert.equal(fs.existsSync(file), false);
});
