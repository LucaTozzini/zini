import assert from "node:assert/strict";
import test from "node:test";
import { checklistVerdict, draftPlan, editPlan, resetChecks, unfinishedPlan } from "./plan.js";

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

test("editing a plan changes only what the edits name, by id or title, and keeps unchanged statuses", () => {
  const first = draftPlan(
    null,
    "## Approach\nA separate recipients table.\n\n## Risks\nNone.",
    [
      { title: "Approval: guest", html: "<p>Places listing</p>" },
      { title: "Approval: signed in", html: "<p>Names</p>" },
    ],
    ["Add the recipients table", "Add the requests table", "Show the approval card"],
    ["Requests are saved", "Recipients are saved"],
  );
  const progressed = { ...first, steps: first.steps.map((step) => ({ ...step, status: "complete" as const })) };
  const edited = editPlan(progressed, {
    design: [{ oldText: "A separate recipients table.", newText: "One quote_requests row per contractor, with a batch id." }],
    mockups: [
      { title: "Approval: guest", html: "<p>Contractor names</p>" },
      { title: "Approval: signed in" },
      { title: "Approval: sent", html: "<p>Sent</p>" },
    ],
    steps: [
      { action: "remove", id: "S1" },
      { action: "replace", id: "S2", text: "Add the requests table with a batch id" },
      { action: "insert", id: "S2", text: "Group requests by batch" },
      { action: "insert", text: "Document the batch id" },
    ],
    qaChecklist: [{ action: "remove", id: "Q2" }],
  });
  assert.equal(edited.design, "## Approach\nOne quote_requests row per contractor, with a batch id.\n\n## Risks\nNone.");
  assert.deepEqual(edited.mockups, [
    { title: "Approval: guest", html: "<p>Contractor names</p>" },
    { title: "Approval: sent", html: "<p>Sent</p>" },
  ]);
  assert.deepEqual(edited.steps, [
    "Add the requests table with a batch id",
    "Group requests by batch",
    "Show the approval card",
    "Document the batch id",
  ]);
  assert.deepEqual(edited.qaChecklist, ["Requests are saved"]);
  const next = draftPlan(progressed, edited.design, edited.mockups, edited.steps, edited.qaChecklist);
  assert.equal(next.revision, 2);
  assert.deepEqual(
    next.steps.map((step) => `${step.id} ${step.status}`),
    ["S1 todo", "S2 todo", "S3 complete", "S4 todo"],
  );
});

test("an edit that doesn't apply fails, naming it", () => {
  const plan = draftPlan(null, "Count the list.", [], ["Add the count"], ["Count shows"]);
  assert.throws(
    () => editPlan(plan, { design: [{ oldText: "Missing", newText: "x" }] }),
    /design edit 1: oldText isn't in the design/,
  );
  assert.throws(() => editPlan(plan, { steps: [{ action: "remove", id: "S9" }] }), /step edit 1: there's no S9/);
  assert.throws(
    () => editPlan(plan, { qaChecklist: [{ action: "replace", id: "Q1" }] }),
    /QA check edit 1: replace needs the text/,
  );
  assert.throws(() => editPlan(plan, { mockups: [{ title: "Nope" }] }), /mockup edit 1: there's no mockup "Nope"/);
});
