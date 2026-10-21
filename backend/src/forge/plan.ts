import type { ForgePlan, LinearIssueDetails, Mockup } from "shared";
import { replaceOnce } from "../core/textEdit.js";

// The Lead's plan (see shared's ForgePlan): its design and mockups, its steps, which the
// Lead marks off, and its QA checklist, which only the Reviewer marks. Every change to its contents
// needs your approval; statuses don't.

// The next revision of the plan, from the Lead's design, mockups and lists. Steps and checks
// whose text is unchanged keep their status (and a check its note); the rest start as
// todo. Ids follow the order.
export function draftPlan(
  previous: ForgePlan | null,
  design: string,
  mockups: Mockup[],
  steps: string[],
  qaChecklist: string[],
): ForgePlan {
  const stepStatus = new Map(previous?.steps.map((step) => [step.description, step.status]));
  const checks = new Map(previous?.qaChecklist.map((check) => [check.condition, check]));
  return {
    revision: (previous?.revision ?? 0) + 1,
    design,
    mockups,
    steps: steps.map((description, i) => ({ id: `S${i + 1}`, description, status: stepStatus.get(description) ?? "todo" })),
    qaChecklist: qaChecklist.map((condition, i) => {
      const old = checks.get(condition);
      return { id: `Q${i + 1}`, condition, status: old?.status ?? "todo", note: old?.note ?? "" };
    }),
  };
}

// A change to the plan's steps or QA checks, by id as they were before the edit: replace
// one's text, remove one, or insert a new one after one (at the end without an id).
export type ListEdit = { action: "replace" | "remove" | "insert"; id?: string; text?: string };
// Changes to part of the plan (see editPlan). A mockup with html replaces the one with its
// title, or is added; without html, it's removed.
export type PlanEdits = {
  design?: { oldText: string; newText: string }[];
  mockups?: { title: string; html?: string }[];
  steps?: ListEdit[];
  qaChecklist?: ListEdit[];
};

function editList(items: { id: string; text: string }[], edits: ListEdit[], kind: string): string[] {
  const texts = new Map<string, string | null>(items.map((item) => [item.id, item.text]));
  // Inserted texts by the id they go after; null for the end.
  const inserted = new Map<string | null, string[]>();
  edits.forEach(({ action, id, text }, i) => {
    const fail = (problem: string) => {
      throw new Error(`${kind} edit ${i + 1}: ${problem}`);
    };
    if (id !== undefined && !texts.has(id)) fail(`there's no ${id}`);
    if (action !== "insert" && id === undefined) fail(`${action} needs the id`);
    if (action !== "remove" && !text?.trim()) fail(`${action} needs the text`);
    if (action === "remove") texts.set(id!, null);
    else if (action === "replace") texts.set(id!, text!);
    else inserted.set(id ?? null, [...(inserted.get(id ?? null) ?? []), text!]);
  });
  return [
    ...items.flatMap((item) => [...(texts.get(item.id) === null ? [] : [texts.get(item.id)!]), ...(inserted.get(item.id) ?? [])]),
    ...(inserted.get(null) ?? []),
  ];
}

// The plan's contents with the edits applied, all or none: an edit that doesn't apply
// throws, naming it. For draftPlan, which makes them the next revision.
export function editPlan(plan: ForgePlan, edits: PlanEdits) {
  const design = (edits.design ?? []).reduce((text, { oldText, newText }, i) => {
    try {
      return replaceOnce(text, oldText, newText, "the design");
    } catch (err) {
      throw new Error(`design edit ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, plan.design);
  const mockups = [...plan.mockups];
  (edits.mockups ?? []).forEach(({ title, html }, i) => {
    const at = mockups.findIndex((mockup) => mockup.title === title);
    if (html) {
      if (at === -1) mockups.push({ title, html });
      else mockups[at] = { title, html };
    } else if (at === -1) throw new Error(`mockup edit ${i + 1}: there's no mockup "${title}" to remove`);
    else mockups.splice(at, 1);
  });
  return {
    design,
    mockups,
    steps: editList(
      plan.steps.map(({ id, description }) => ({ id, text: description })),
      edits.steps ?? [],
      "step",
    ),
    qaChecklist: editList(
      plan.qaChecklist.map(({ id, condition }) => ({ id, text: condition })),
      edits.qaChecklist ?? [],
      "QA check",
    ),
  };
}

// New code invalidates every check: they all go back to todo.
export const resetChecks = (plan: ForgePlan): ForgePlan => ({
  ...plan,
  qaChecklist: plan.qaChecklist.map((check) => ({ ...check, status: "todo", note: "" })),
});

export const planText = (plan: ForgePlan) =>
  [
    "Implementation steps:",
    ...plan.steps.map((step) => `- ${step.id} [${step.status}] ${step.description}`),
    "",
    "QA checklist:",
    ...plan.qaChecklist.map(
      (check) => `- ${check.id} [${check.status}] ${check.condition}${check.note ? ` (${check.note})` : ""}`,
    ),
  ].join("\n");

// What keeps the plan from being finished: steps not complete, checks not passed or
// skipped. Empty when it's done.
export function unfinishedPlan(plan: ForgePlan | null, approved: boolean) {
  if (!plan) return ["There is no plan yet."];
  if (!approved) return ["The plan isn't approved yet."];
  if (!plan.qaChecklist.length) return ["The QA checklist is empty."];
  return [
    ...plan.steps
      .filter((step) => step.status !== "complete")
      .map((step) => `Step ${step.id} is ${step.status}: ${step.description}`),
    ...plan.qaChecklist
      .filter((check) => check.status !== "passed" && check.status !== "skipped")
      .map((check) => `QA check ${check.id} is ${check.status}: ${check.condition}`),
  ];
}

// The checklist's overall result, for status reports and evals.
export function checklistVerdict(plan: ForgePlan | null): "pass" | "fail" | "partial" | null {
  if (!plan?.qaChecklist.length) return null;
  if (plan.qaChecklist.some((check) => check.status === "failed")) return "fail";
  return plan.qaChecklist.every((check) => check.status === "passed" || check.status === "skipped") ? "pass" : "partial";
}

export function issueText(issue: LinearIssueDetails) {
  const comments = issue.comments.map((c) => `- ${c.user?.name ?? "An integration"} (${c.createdAt.slice(0, 10)}): ${c.body}`);
  return [
    `# ${issue.identifier}: ${issue.title}`,
    issue.description?.trim() || "(No description.)",
    comments.length ? `## Comments, oldest first\n${comments.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
