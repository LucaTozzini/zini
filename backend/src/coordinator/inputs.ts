import type { Clarification, LinearIssueDetails, PlanDocument } from "shared";

// What each subagent is given: the issue and the parts of the pipeline's state it
// needs, as markdown (the reviewer's input; the planner's and coder's system prompt).

function issueText(issue: LinearIssueDetails) {
  const comments = issue.comments.map(
    (c) =>
      `- ${c.user?.name ?? "An integration"} (${c.createdAt.slice(0, 10)}): ${c.body}`,
  );
  return [
    `# ${issue.identifier}: ${issue.title}`,
    issue.description?.trim() || "(No description.)",
    comments.length ? `## Comments, oldest first\n${comments.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const listText = (items: string[], numbered = false) =>
  items.map((item, i) => `${numbered ? `${i + 1}.` : "-"} ${item}`).join("\n");

// The input for a subagent: the issue (fetched fresh, so edits and new comments count)
// and whatever parts of the state it needs, as markdown sections. Empty sections are
// left out.
export function inputText(
  issue: LinearIssueDetails,
  sections: [string, string | false | null | undefined][],
) {
  return [
    `# The Linear issue\n\n${issueText(issue)}`,
    ...sections
      .filter(([, body]) => body)
      .map(([title, body]) => `# ${title}\n\n${body}`),
  ].join("\n\n");
}

export const clarificationsText = (clarifications: Clarification[]) =>
  clarifications.length > 0 &&
  clarifications
    .map((c) => `Q (${c.from}): ${c.question}\nA: ${c.answer}`)
    .join("\n\n");

// The answers to a document's questions: the last clarifications, since answering
// appends one per question (see the ask nodes).
export const answersText = (clarifications: Clarification[], document: { blockingQuestions: string[] }) =>
  clarificationsText(clarifications.slice(-document.blockingQuestions.length));

export const planText = (plan: PlanDocument) =>
  `${plan.summary}\n\n${listText(plan.steps, true)}`;
