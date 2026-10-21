import type { ForgePlan, LinearIssueDetails, Mockup } from "shared";

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
