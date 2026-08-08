import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { beginUserHold, provideUserReply, waitForUserReply } from "../src/user-hold.js";
import { tempWorkspace } from "./helpers.js";

test("sensitive human replies use a one-time 0600 file and are deleted after consumption", async () => {
  const workspace = tempWorkspace();
  const hold = beginUserHold(workspace, {
    kind: "otp",
    keepAlive: true,
    runId: "run-1",
    phaseId: "P01",
    attempt: 1,
  });
  assert.equal(hold.sensitive, true);
  const delivered = provideUserReply(workspace, "123456");
  assert.equal(fs.statSync(delivered.replyPath).mode & 0o777, 0o600);
  const received = await waitForUserReply(workspace, { timeoutMs: 100, pollMs: 5 });
  assert.equal(received.reply, "123456");
  assert.equal(received.consumed, true);
  assert.equal(fs.existsSync(delivered.replyPath), false);
});

test("executor wait returns only an opaque path for sensitive replies", async () => {
  const workspace = tempWorkspace();
  beginUserHold(workspace, {
    kind: "credentials",
    keepAlive: true,
    runId: "run-opaque",
    phaseId: "P02",
    attempt: 1,
  });
  const delivered = provideUserReply(workspace, "synthetic-secret");
  const received = await waitForUserReply(workspace, {
    timeoutMs: 100,
    pollMs: 5,
    exposeSensitive: false,
  });
  assert.equal(received.ok, true);
  assert.equal(received.reply, undefined);
  assert.equal(received.replyPath, delivered.replyPath);
  assert.equal(received.consumed, false);
  assert.equal(fs.existsSync(delivered.replyPath), true);
  fs.unlinkSync(delivered.replyPath);
});
