import test from "node:test";
import assert from "node:assert/strict";
import { isModelRateLimit } from "./modelErrors.js";

test("rate limits are recognised through wrappers and messages", () => {
  const error = Object.assign(new Error("Quota exhausted"), { status: 429 });
  assert.equal(isModelRateLimit(error), true);
  assert.equal(isModelRateLimit(new Error("Wrapper", { cause: error })), true);
  assert.equal(isModelRateLimit("429 Rate limit exceeded: free-models-per-day-stealth"), true);
  assert.equal(isModelRateLimit(new Error("Invalid tool arguments")), false);
  const cyclic = { cause: null as unknown };
  cyclic.cause = cyclic;
  assert.equal(isModelRateLimit(cyclic), false);
});
