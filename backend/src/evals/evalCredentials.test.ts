import assert from "node:assert/strict";
import test from "node:test";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createEvalCredentials } from "./evalCredentials.js";

test("eval credentials rotate during a run and are removed on close", async () => {
  let calls = 0;
  let rotated!: () => void;
  const next = new Promise<void>((resolve) => { rotated = resolve; });
  const credentials = await createEvalCredentials(async () => {
    if (++calls === 1) return "first-token";
    rotated();
    return "refreshed-token";
  }, (error) => { throw error; }, 100);
  const file = join(credentials.directory, "access-token");
  try {
    assert.equal(await readFile(file, "utf8"), "first-token");
    await next;
    for (let attempt = 0; attempt < 100 && await readFile(file, "utf8") !== "refreshed-token"; attempt++) {
      await delay(5);
    }
    assert.equal(await readFile(file, "utf8"), "refreshed-token");
    // Closing drains the pending atomic replacement before removing the directory.
    await credentials.close();
    await assert.rejects(access(file), { code: "ENOENT" });
    assert.ok(calls >= 2);
  } finally { await credentials.close(); }
});

test("credential refresh failures are reported and the mount can be cleaned up", async () => {
  let calls = 0;
  let failed!: (error: unknown) => void;
  const failure = new Promise<unknown>((resolve) => { failed = resolve; });
  const credentials = await createEvalCredentials(async () => {
    if (++calls === 1) return "first-token";
    throw new Error("session expired");
  }, failed, 10);
  try {
    assert.match(String(await failure), /session expired/);
    assert.equal(await readFile(join(credentials.directory, "access-token"), "utf8"), "first-token");
  } finally { await credentials.close(); }
});
