import assert from "node:assert/strict";
import test from "node:test";
import type { PipelineState } from "shared";
import { checksSkipped } from "../src/components/pipeline/progress.ts";

const initial: PipelineState = {
  started: false, running: null, waiting: null, plan: null, planApproved: false,
  implementation: null, checks: null, review: null, qa: null, clarifications: [],
  browserUrl: null, finished: false, error: null,
};

test("missing reports are not skipped before or during checks", () => {
  for (const running of [null, "planner", "coder", "checks"] as const) {
    assert.equal(checksSkipped({ ...initial, running }), false);
  }
  assert.equal(checksSkipped({ ...initial, waiting: { kind: "approve_commands", from: "checks", commands: [] } }), false);
});

test("legacy runs reaching review, QA, or completion without checks show the warning", () => {
  for (const running of ["reviewer", "qa"] as const) {
    assert.equal(checksSkipped({ ...initial, running }), true);
  }
  assert.equal(checksSkipped({ ...initial, finished: true }), true);
  assert.equal(checksSkipped({ ...initial, waiting: { kind: "questions", from: "qa", questions: ["Question?"] } }), true);
  assert.equal(checksSkipped({ ...initial, waiting: { kind: "approve_commands", from: "qa", commands: [] } }), true);
});

test("saved checks reports are never treated as skipped", () => {
  assert.equal(checksSkipped({ ...initial, running: "qa",
    checks: { revision: "revision", complete: false, couldNotTest: [], results: [] },
  }), false);
});

test("repairs use the running or saved pending role rather than stale later reports", () => {
  const stale = { ...initial, started: true, planApproved: true,
    implementation: { blockingQuestions: [] },
    review: { requiredChanges: [], blockingQuestions: [] },
    qa: { verdict: "pass" as const, checks: [], failures: [], couldNotTest: [], blockingQuestions: [] },
  };
  assert.equal(checksSkipped({ ...stale, running: "coder" }), false);
  assert.equal(checksSkipped({ ...stale, canResume: true, pendingRole: "checks" }), false);
  assert.equal(checksSkipped({ ...stale, canResume: true, pendingRole: "reviewer" }), true);
});
