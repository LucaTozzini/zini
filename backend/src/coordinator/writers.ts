import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { LinearIssueDetails, LogRole } from "shared";
import { commitContext, coordinatorModel, type Setup } from "../coordinator.js";
import { fetchLinearIssue } from "../linear.js";
import { branchCommitMessages, branchCommits } from "../workspaceFiles.js";
import { clarificationsText, inputText, listText, planText } from "./inputs.js";
import { openRunLog } from "./runLog.js";
import { COMMITTER_PROMPT, PR_WRITER_PROMPT } from "./systemPrompts.js";
import { diffForModel } from "./tools.js";

// The writers: the committer writes the commit message for the workspace's uncommitted
// changes, and the PR writer the pull request for its branch, for you to read (and
// edit) before using them. Outside the pipeline, and one-shots: one model call each,
// with no tools, answering with text. Logged like the subagents (see runLog.ts), with
// just their start and end.

// The issue, and what the pipeline says about the changes: the approved plan, and your
// answers and feedback, which explain them.
async function context(setup: Setup, issueId: string) {
  const [issue, pipeline] = await Promise.all([
    fetchLinearIssue(setup.linear, issueId),
    commitContext(issueId),
  ]);
  const sections: [string, string | false | null][] = [
    ["The approved plan", pipeline.plan && planText(pipeline.plan)],
    ["The user's answers", clarificationsText(pipeline.clarifications)],
    ["The user's feedback on the plan", pipeline.planFeedback.length > 0 && listText(pipeline.planFeedback)],
    [
      "The user's feedback on the changes, oldest first",
      pipeline.implementationFeedback.length > 0 && listText(pipeline.implementationFeedback),
    ],
  ];
  return { issue, sections };
}

// Runs a writer: one model call (tried twice more if it fails, like the subagents'),
// logged, and its reply's text.
async function write(setup: Setup, issueId: string, role: LogRole, prompt: string, input: string) {
  const log = await openRunLog(issueId, role);
  await log.write({ event: "start", role, model: setup.model, prompt, input });
  try {
    const reply = await coordinatorModel(setup)
      .withRetry({ stopAfterAttempt: 3 })
      .invoke([new SystemMessage(prompt), new HumanMessage(input)]);
    const text = reply.text.trim();
    if (!text) throw new Error("The model replied with nothing");
    await log.write({ event: "end", outcome: "done", document: { text } });
    return text;
  } catch (err) {
    await log.write({ event: "end", outcome: "error", error: String(err) });
    throw err;
  }
}

export async function writeCommitMessage(setup: Setup, issueId: string) {
  const [{ issue, sections }, commits, changes] = await Promise.all([
    context(setup, issueId),
    branchCommits(issueId),
    diffForModel(issueId, undefined, { uncommitted: true, tools: false }),
  ]);
  const input = inputText(issue, [
    ...sections,
    ["Earlier commits on this branch, oldest first", commits.length > 0 && listText(commits)],
    ["The changes in this commit", changes],
  ]);
  return write(setup, issueId, "committer", COMMITTER_PROMPT, input);
}

// The pull request's title always starts with the issue's identifier, so Linear links
// it to the issue.
export const withIdentifier = (issue: Pick<LinearIssueDetails, "identifier">, title: string) =>
  title.startsWith(issue.identifier) ? title : `${issue.identifier}: ${title}`;

// The title (the reply's first line, with the issue's identifier) and the body (the
// rest).
export async function writePullRequest(setup: Setup, issueId: string) {
  const [{ issue, sections }, commits, changes] = await Promise.all([
    context(setup, issueId),
    branchCommitMessages(issueId),
    diffForModel(issueId, undefined, { tools: false }),
  ]);
  const input = inputText(issue, [
    ...sections,
    ["The commits on this branch, oldest first", commits.length > 0 && commits.join("\n\n---\n\n")],
    ["The changes on this branch", changes],
  ]);
  const text = await write(setup, issueId, "pr_writer", PR_WRITER_PROMPT, input);
  const [title = "", ...body] = text.split("\n");
  return { title: withIdentifier(issue, title.replace(/^#+\s*/, "").trim()), body: body.join("\n").trim() };
}
