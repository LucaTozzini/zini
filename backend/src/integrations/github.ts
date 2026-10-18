import { Octokit } from "@octokit/rest";
import type { PullRequest } from "shared";

// Failed requests are thrown (see attempt), so Octokit doesn't also log them.
const quiet = { debug: () => {}, info: () => {}, warn: console.warn, error: () => {} };
const github = (token: string) => new Octokit({ auth: token, userAgent: "zini", log: quiet });

const ownerAndName = (repo: string) => {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, repo: name };
};

// call's result, or an error with what failed and what GitHub said: its status, message,
// and each validation error (e.g. "A pull request already exists for ...").
async function attempt<T>(what: string, call: Promise<T>) {
  try {
    return await call;
  } catch (error) {
    const { status, response } = error as {
      status?: number;
      response?: { data?: { message?: string; errors?: { message?: string; code?: string }[] } };
    };
    const body = response?.data;
    const details = (body?.errors ?? []).map((e) => e.message ?? e.code).filter(Boolean);
    const message = [body?.message ?? (error instanceof Error ? error.message : String(error)), ...details];
    throw new Error(`${what} failed${status ? ` (${status})` : ""}: ${message.filter(Boolean).join(": ")}`);
  }
}

// true if GitHub accepts the token, false if it rejects it (401).
// Other failures are thrown, since they say nothing about the token.
export async function testGitHubKey(token: string) {
  try {
    await github(token).rest.users.getAuthenticated();
    return true;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401) return false;
    throw new Error(`GitHub token check failed: ${status ?? (error instanceof Error ? error.message : String(error))}`);
  }
}

type GitHubPull = { number: number; html_url: string; state: string; merged_at: string | null };

const toPullRequest = (pull: GitHubPull): PullRequest => ({
  number: pull.number,
  url: pull.html_url,
  state: pull.merged_at ? "merged" : pull.state === "open" ? "open" : "closed",
});

// The newest pull request from branch in repo ("owner/name"), whatever its state, or
// null if it has none.
export async function findPullRequest(token: string, repo: string, branch: string) {
  const { owner, repo: name } = ownerAndName(repo);
  const { data } = await attempt(
    "Looking up the pull request",
    github(token).rest.pulls.list({ owner, repo: name, head: `${owner}:${branch}`, state: "all", per_page: 1 }),
  );
  return data[0] ? toPullRequest(data[0]) : null;
}

export async function getPullRequest(token: string, repo: string, number: number) {
  const { data: pull } = await attempt(
    "Reading the pull request",
    github(token).rest.pulls.get({ ...ownerAndName(repo), pull_number: number }),
  );
  return {
    ...toPullRequest(pull),
    title: pull.title,
    body: pull.body ?? "",
    branch: pull.head.ref,
    head: pull.head.sha,
    headRepo: pull.head.repo?.full_name ?? null,
    base: pull.base.ref,
  };
}

// Opens a pull request from branch into base, ready for review.
export async function createPullRequest(
  token: string,
  repo: string,
  pull: { title: string; body: string; branch: string; base: string },
) {
  const { data } = await attempt(
    "Opening the pull request",
    github(token).rest.pulls.create({
      ...ownerAndName(repo),
      title: pull.title,
      body: pull.body,
      head: pull.branch,
      base: pull.base,
    }),
  );
  return toPullRequest(data);
}

// Each review comment's thread, by the comment's id: the thread's id and whether it's resolved.
// GraphQL, since the REST API lacks review threads.
async function reviewThreads(octokit: Octokit, repo: string, number: number) {
  type Threads = {
    nodes: { id: string; isResolved: boolean; comments: { nodes: { databaseId: number }[] } }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
  const { owner, repo: name } = ownerAndName(repo);
  const threads = new Map<number, { threadId: string; resolved: boolean }>();
  let after: string | null = null;
  do {
    const data: { repository: { pullRequest: { reviewThreads: Threads } } } = await attempt(
      "Reading the pull request's review threads",
      octokit.graphql(
        `
          query ($owner: String!, $name: String!, $number: Int!, $after: String) {
            repository(owner: $owner, name: $name) {
              pullRequest(number: $number) {
                reviewThreads(first: 100, after: $after) {
                  nodes {
                    id
                    isResolved
                    comments(first: 100) {
                      nodes {
                        databaseId
                      }
                    }
                  }
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                }
              }
            }
          }
        `,
        { owner, name, number, after },
      ),
    );
    const page = data.repository.pullRequest.reviewThreads;
    for (const thread of page.nodes)
      for (const comment of thread.comments.nodes)
        threads.set(comment.databaseId, { threadId: thread.id, resolved: thread.isResolved });
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return threads;
}

// A pull request with its whole conversation, oldest first: comments, reviews, and
// review comments on lines of the diff (replyTo is the comment a reply answers, and
// threadId the thread to resolve).
export async function readPullRequestThread(token: string, repo: string, number: number) {
  const octokit = github(token);
  const pullRequest = { ...ownerAndName(repo), per_page: 100 };
  const [pull, comments, reviews, reviewComments, threads] = await Promise.all([
    getPullRequest(token, repo, number),
    attempt(
      "Reading the pull request's comments",
      octokit.paginate(octokit.rest.issues.listComments, { ...pullRequest, issue_number: number }),
    ),
    attempt(
      "Reading the pull request's reviews",
      octokit.paginate(octokit.rest.pulls.listReviews, { ...pullRequest, pull_number: number }),
    ),
    attempt(
      "Reading the pull request's review comments",
      octokit.paginate(octokit.rest.pulls.listReviewComments, { ...pullRequest, pull_number: number }),
    ),
    reviewThreads(octokit, repo, number),
  ]);
  const thread = [
    ...comments.map((c) => ({ type: "comment" as const, author: c.user?.login ?? null, at: c.created_at, body: c.body ?? "" })),
    ...reviews
      .filter((r) => r.submitted_at)
      .map((r) => ({
        type: "review" as const,
        author: r.user?.login ?? null,
        at: r.submitted_at!,
        state: r.state,
        body: r.body ?? "",
      })),
    ...reviewComments.map((c) => ({
      type: "review_comment" as const,
      id: c.id,
      author: c.user?.login ?? null,
      at: c.created_at,
      path: c.path,
      line: c.line ?? c.original_line ?? null,
      outdated: c.line == null,
      replyTo: c.in_reply_to_id ?? null,
      ...threads.get(c.id),
      body: c.body,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return { ...pull, thread };
}

// Comments on the pull request's conversation, or with replyTo (a review comment's id),
// replies in that review comment's thread. Returns the new comment's URL.
export async function commentOnPullRequest(token: string, repo: string, number: number, body: string, replyTo?: number) {
  const octokit = github(token);
  const { data } =
    replyTo === undefined
      ? await attempt(
          "Commenting on the pull request",
          octokit.rest.issues.createComment({ ...ownerAndName(repo), issue_number: number, body }),
        )
      : await attempt(
          "Replying to the review comment",
          octokit.rest.pulls.createReplyForReviewComment({
            ...ownerAndName(repo),
            pull_number: number,
            comment_id: replyTo,
            body,
          }),
        );
  return data.html_url;
}

// Resolves a review thread (threadId from readPullRequestThread), or reopens it.
export async function resolveReviewThread(token: string, threadId: string, resolved: boolean) {
  const mutation = resolved ? "resolveReviewThread" : "unresolveReviewThread";
  const data = await attempt(
    resolved ? "Resolving the review thread" : "Reopening the review thread",
    github(token).graphql<Record<string, { thread: { isResolved: boolean } }>>(
      `mutation($threadId: ID!) { ${mutation}(input: { threadId: $threadId }) { thread { isResolved } } }`,
      { threadId },
    ),
  );
  return data[mutation]!.thread.isResolved;
}
