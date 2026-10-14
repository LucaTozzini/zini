import test from "node:test";
import assert from "node:assert/strict";
import { ReviewEvidence } from "./reviewerTools.js";

const review = { requiredChanges: [], blockingQuestions: [], preexistingFailures: [] };
test("reviewer approval requires executed checks and an explanation for failures", () => {
  const evidence = new ReviewEvidence(null, "v1");
  assert.match(evidence.validate(review)!, /Run relevant checks/);
  assert.equal(evidence.validate({ ...review, noChecksReason: "Docs-only repository with no configured checks" }), undefined);
  evidence.record({ command: "npm test", cwd: ".", purpose: "Regression", status: "failed", exitCode: 1, output: "Missing database" });
  assert.match(evidence.validate(review)!, /unexplained failed/);
  assert.equal(evidence.validate({ ...review, requiredChanges: ["Fix assertion in index.ts:2"] }), undefined);
  evidence.record({ command: "npm test", cwd: ".", purpose: "Regression", status: "passed", exitCode: 0, output: "Passed" });
  assert.equal(evidence.results.length, 1);
  assert.equal(evidence.validate(review), undefined);
  assert.equal(new ReviewEvidence(evidence.report(), "v2").results.length, 0);
});

test("a check that already failed before the change doesn't block approval, and is reported as such", () => {
  const evidence = new ReviewEvidence(null, "v1");
  evidence.record({ command: "npm run lint", cwd: ".", purpose: "Lint", status: "failed", exitCode: 1, output: "137 errors in untouched files" });
  assert.match(evidence.validate(review)!, /unexplained failed/);
  const preexistingFailures = [{ command: "npm run lint", reason: "Every error is in files this change doesn't touch" }];
  assert.equal(evidence.validate({ ...review, preexistingFailures }), undefined);
  // One that names no recorded failed check excuses nothing, and isn't an error.
  const unrelated = [{ command: "npm test", reason: "Never run" }];
  assert.match(evidence.validate({ ...review, preexistingFailures: unrelated })!, /unexplained failed/);
  assert.equal(evidence.validate({ ...review, requiredChanges: ["Fix index.ts:2"], preexistingFailures: unrelated }), undefined);
  assert.equal(evidence.report(undefined, unrelated).results[0]!.preexisting, undefined);
  assert.equal(evidence.report(undefined, preexistingFailures).results[0]!.preexisting, preexistingFailures[0]!.reason);
});
