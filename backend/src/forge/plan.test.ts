import assert from "node:assert/strict";
import test from "node:test";
import { checklistVerdict, draftPlan, resetChecks, unfinishedPlan } from "./plan.js";

test("a redrafted plan is the next revision, keeps the status of unchanged steps and checks, and numbers them in order", () => {
  const first = draftPlan(null, "Count the list.", [], ["Add the count", "Style it"], ["Count shows", "Tests pass"]);
  assert.equal(first.revision, 1);
  assert.equal(first.design, "Count the list.");
  const progressed = {
    ...first,
    steps: first.steps.map((step) => ({ ...step, status: "complete" as const })),
    qaChecklist: first.qaChecklist.map((check) => ({ ...check, status: "failed" as const, note: "Broken" })),
  };
  const next = draftPlan(
    progressed,
    "Count the list, hidden when empty.",
    [{ title: "To-do list: empty", html: "<p>No to-dos</p>" }],
    ["Hide it when empty", "Add the count"],
    ["Tests pass"],
  );
  assert.equal(next.revision, 2);
  assert.deepEqual(next.mockups, [{ title: "To-do list: empty", html: "<p>No to-dos</p>" }]);
  assert.deepEqual(next.steps, [
    { id: "S1", description: "Hide it when empty", status: "todo" },
    { id: "S2", description: "Add the count", status: "complete" },
  ]);
  assert.deepEqual(next.qaChecklist, [{ id: "Q1", condition: "Tests pass", status: "failed", note: "Broken" }]);
  assert.deepEqual(resetChecks(next).qaChecklist, [{ id: "Q1", condition: "Tests pass", status: "todo", note: "" }]);
});

test("a plan is finished only when approved, every step is complete and every check passed or was skipped", () => {
  const plan = draftPlan(null, "Count the list.", [], ["Add the count"], ["Count shows", "Works offline"]);
  assert.deepEqual(unfinishedPlan(null, false), ["There is no plan yet."]);
  assert.deepEqual(unfinishedPlan(plan, false), ["The plan isn't approved yet."]);
  assert.equal(unfinishedPlan(plan, true).length, 3);
  assert.equal(checklistVerdict(plan), "partial");
  const done = {
    ...plan,
    steps: plan.steps.map((step) => ({ ...step, status: "complete" as const })),
    qaChecklist: [
      { ...plan.qaChecklist[0]!, status: "passed" as const },
      { ...plan.qaChecklist[1]!, status: "skipped" as const, note: "No network control" },
    ],
  };
  assert.deepEqual(unfinishedPlan(done, true), []);
  assert.equal(checklistVerdict(done), "pass");
  assert.equal(checklistVerdict({ ...done, qaChecklist: [{ ...done.qaChecklist[0]!, status: "failed" }] }), "fail");
  assert.deepEqual(unfinishedPlan({ ...done, qaChecklist: [] }, true), ["The QA checklist is empty."]);
});
