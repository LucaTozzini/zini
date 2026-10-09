import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { forgetRun, isRunning, pauseRun, runStatus, startRun } from "./runs.js";

test("pause locks the run until cancellation drains, then permits manual continuation", async () => {
  const id = "pause-test";
  let release!: () => void;
  const drained = new Promise<void>((resolve) => { release = resolve; });
  let signal!: AbortSignal;
  let notifications = 0;
  try {
    assert.equal(await startRun(id, async (s) => {
      signal = s;
      return (async function* () {
        yield {};
        await drained;
        s.throwIfAborted();
      })();
    }, () => { notifications++; }), true);
    assert.equal(pauseRun(id), true);
    assert.equal(signal.aborted, true);
    assert.equal(runStatus(id).pausing, true);
    assert.equal(isRunning(id), true);
    assert.equal(pauseRun(id), false);
    assert.equal(await startRun(id, async () => (async function* () {})(), () => {}), false);
    release();
    await setImmediate();
    assert.deepEqual(runStatus(id), { running: false, pausing: false, error: null });
    assert.equal(notifications, 2);
    assert.equal(await startRun(id, async () => (async function* () { yield {}; })(), () => {}), true);
    await setImmediate();
    assert.equal(isRunning(id), false);
  } finally { release(); forgetRun(id); }
});

test("pause rejects an idle run", () => {
  assert.equal(pauseRun("not-running"), false);
});
