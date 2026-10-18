import { tool } from "langchain";
import { z } from "zod";
import { getKey } from "../models/Integration.js";
import { commentOnPullRequest, readPullRequestThread, resolveReviewThread } from "../integrations/github.js";

// Reading and answering the repo's pull requests. repo is the githubRepo setting, "owner/name".
export function pullRequestTools(repo: string) {
  // The GitHub token is read per call, like the setup, so a new one applies straight away.
  const github = async () => {
    const token = await getKey("github");
    if (!token) throw new Error("GitHub isn't connected");
    return token;
  };
  const NUMBER = z.number().int().positive().describe("The pull request's number");
  return [
    tool(async ({ number }) => JSON.stringify(await readPullRequestThread(await github(), repo, number)), {
      name: "pull_request_read",
      description:
        "Read a pull request of the repo with its whole thread, oldest first: comments on " +
        "its conversation, reviews with their verdicts, and review comments on lines of the " +
        "diff, with their thread's id and whether it's resolved. An issue's pull requests " +
        "are among its attachments (get_issue).",
      schema: z.object({ number: NUMBER }),
    }),
    tool(
      async ({ number, body, replyTo }) =>
        JSON.stringify({ url: await commentOnPullRequest(await github(), repo, number, body, replyTo) }),
      {
        name: "pull_request_comment",
        description:
          "Comment on a pull request's conversation, or with replyTo, reply in a review " +
          "comment's thread. Only review comments (on lines of the diff) have threads. " +
          "Posted as the owner of Zini's GitHub token. The user approves the call before it runs.",
        schema: z.object({
          number: NUMBER,
          body: z.string().trim().min(1).describe("Markdown"),
          replyTo: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("The id of a review comment (from pull_request_read) to reply to"),
        }),
      },
    ),
    tool(
      async ({ threadId, resolved }) =>
        JSON.stringify({ resolved: await resolveReviewThread(await github(), threadId, resolved ?? true) }),
      {
        name: "pull_request_resolve_thread",
        description:
          "Resolve a review thread, or with resolved=false, reopen it. The user approves the " + "call before it runs.",
        schema: z.object({
          number: NUMBER.describe("The pull request's number, shown on the approval"),
          threadId: z.string().min(1).describe("A review comment's threadId, from pull_request_read"),
          resolved: z.boolean().optional(),
        }),
      },
    ),
  ];
}
