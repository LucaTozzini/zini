import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { commitContext, coordinatorModel, type Setup } from "../coordinator.js";
import { fetchLinearIssue } from "../linear.js";
import { branchCommits } from "../workspaceFiles.js";
import { clarificationsText, inputText, listText, planText } from "./inputs.js";
import { openRunLog } from "./runLog.js";
import { COMMITTER_PROMPT } from "./systemPrompts.js";
import { diffForModel } from "./tools.js";

// The committer: writes the commit message for the workspace's uncommitted changes, for
// you to read (and edit) before committing. Outside the pipeline, and a one-shot: one
// model call, with no tools, answering with the message as text. Logged like the
// subagents (see runLog.ts), with just its start and end.
export async function writeCommitMessage(setup: Setup, issueId: string) {
  const [issue, context, commits, changes] = await Promise.all([
    fetchLinearIssue(setup.linear, issueId),
    commitContext(issueId),
    branchCommits(issueId),
    diffForModel(issueId, undefined, true),
  ]);
  const input = inputText(issue, [
    ["The approved plan", context.plan && planText(context.plan)],
    ["The user's answers", clarificationsText(context.clarifications)],
    ["The user's feedback on the plan", context.planFeedback.length > 0 && listText(context.planFeedback)],
    [
      "The user's feedback on the changes, oldest first",
      context.implementationFeedback.length > 0 && listText(context.implementationFeedback),
    ],
    ["Earlier commits on this branch, oldest first", commits.length > 0 && listText(commits)],
    ["The changes in this commit", changes],
  ]);

  const log = await openRunLog(issueId, "committer");
  await log.write({ event: "start", role: "committer", model: setup.model, prompt: COMMITTER_PROMPT, input });
  try {
    // Tried twice more if it fails, like the subagents' calls (see modelRetry).
    const reply = await coordinatorModel(setup)
      .withRetry({ stopAfterAttempt: 3 })
      .invoke([new SystemMessage(COMMITTER_PROMPT), new HumanMessage(input)]);
    const commitMessage = reply.text.trim();
    if (!commitMessage) throw new Error("The model replied with an empty commit message");
    await log.write({ event: "end", outcome: "done", document: { commitMessage } });
    return commitMessage;
  } catch (err) {
    await log.write({ event: "end", outcome: "error", error: String(err) });
    throw err;
  }
}
