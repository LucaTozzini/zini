import test from "node:test";
import assert from "node:assert/strict";
import { ReviewEvidence } from "./reviewerTools.js";

const review = { requiredChanges: [], blockingQuestions: [],  };
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
