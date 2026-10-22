import assert from "node:assert/strict";
import test from "node:test";
import { appState } from "./appLaunches.js";

test("the preview shows the runtime's app state when nothing was started from it", () => {
  assert.deepEqual(appState({ status: "stopped" }, "issue"), { status: "stopped", error: null });
  assert.deepEqual(appState({ status: "ready" }, "issue"), { status: "ready", error: null });
  assert.deepEqual(appState({ status: "failed", error: "Port in use" }, "issue"), { status: "failed", error: "Port in use" });
});
