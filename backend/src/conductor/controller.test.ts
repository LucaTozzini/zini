import assert from "node:assert/strict";
import test from "node:test";
import { ConductorController } from "./controller.js";

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("enable runs immediately; completion schedules once; disable clears the timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const controller = new ConductorController(async () => { calls++; });
  try {
    assert.deepEqual(controller.getStatus(), { running: false, lastRan: null });
    controller.setEnabled(true);
    assert.equal(calls, 1);
    assert.equal(controller.getStatus().running, true);
    await flush();
    controller.setEnabled(true);
    t.mock.timers.tick(299999);
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    assert.equal(calls, 2);
    await flush();
    controller.setEnabled(false);
    t.mock.timers.tick(600000);
    assert.equal(calls, 2);
    controller.setEnabled(true);
    assert.equal(calls, 3);
    await flush();
  } finally { controller.setEnabled(false); }
});

test("disable during an iteration prevents further starts and rescheduling", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let starts = 0;
  const controller = new ConductorController(async (isEnabled) => {
    await held;
    if (isEnabled()) starts++;
  });
  controller.setEnabled(true);
  controller.setEnabled(false);
  release(); await flush();
  assert.equal(starts, 0);
  assert.equal(controller.getStatus().running, false);
  t.mock.timers.tick(600000);
  assert.equal(starts, 0);
});

test("off/on during active work never creates overlapping iterations", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const controller = new ConductorController(async () => { calls++; await held; });
  try {
    controller.setEnabled(true);
    controller.setEnabled(false);
    controller.setEnabled(true);
    assert.equal(calls, 1);
    t.mock.timers.tick(600000);
    assert.equal(calls, 1);
    release(); await flush();
    t.mock.timers.tick(300000);
    assert.equal(calls, 2);
    await flush();
  } finally { release(); controller.setEnabled(false); }
});

test("a failed iteration reports the error and schedules the next check", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: unknown[] = [];
  let calls = 0;
  const controller = new ConductorController(async () => { calls++; throw new Error("offline"); }, (error) => errors.push(error));
  try {
    controller.setEnabled(true); await flush();
    assert.equal(errors.length, 1);
    t.mock.timers.tick(300000); await flush();
    assert.equal(calls, 2);
    assert.equal(errors.length, 2);
  } finally { controller.setEnabled(false); }
});
