import type { PullRequest } from "shared";

export const GITHUB_API_URL = "https://api.github.com";

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "zini",
});

// true if GitHub accepts the token, false if it rejects it (401).
// Other failures are thrown, since they say nothing about the token.
export async function testGitHubKey(token: string) {
  const res = await fetch(`${GITHUB_API_URL}/user`, { headers: headers(token) });
  if (res.status === 401) return false;
  if (!res.ok) throw new Error(`GitHub token check failed: ${res.status}`);
  return true;
}

// A failed call's error, with what GitHub said: its message, and each validation error
// (e.g. "A pull request already exists for ...").
async function apiError(what: string, res: Response) {
  const body = (await res.json().catch(() => null)) as {
    message?: string;
    errors?: { message?: string; code?: string }[];
  } | null;
  const details = (body?.errors ?? []).map((e) => e.message ?? e.code).filter(Boolean);
  return new Error(`${what} failed (${res.status}): ${[body?.message, ...details].filter(Boolean).join(": ")}`);
}

type GitHubPull = { number: number; html_url: string; state: "open" | "closed"; merged_at: string | null };

const toPullRequest = (pull: GitHubPull): PullRequest => ({
  number: pull.number,
  url: pull.html_url,
  state: pull.merged_at ? "merged" : pull.state,
});

// The newest pull request from branch in repo ("owner/name"), whatever its state, or
// null if it has none.
export async function findPullRequest(token: string, repo: string, branch: string) {
  const owner = repo.split("/")[0];
  const query = new URLSearchParams({ head: `${owner}:${branch}`, state: "all", per_page: "1" });
  const res = await fetch(`${GITHUB_API_URL}/repos/${repo}/pulls?${query}`, { headers: headers(token) });
  if (!res.ok) throw await apiError("Looking up the pull request", res);
  const [pull] = (await res.json()) as GitHubPull[];
  return pull ? toPullRequest(pull) : null;
}

export async function getPullRequest(token: string, repo: string, number: number) {
  const res = await fetch(`${GITHUB_API_URL}/repos/${repo}/pulls/${number}`, { headers: headers(token) });
  if (!res.ok) throw await apiError("Reading the pull request", res);
  const pull = await res.json() as GitHubPull & {
    title: string; body: string | null; head: { ref: string; sha: string; repo: { full_name: string } | null }; base: { ref: string };
  };
  return { ...toPullRequest(pull), title: pull.title, body: pull.body ?? "", branch: pull.head.ref,
    head: pull.head.sha, headRepo: pull.head.repo?.full_name ?? null, base: pull.base.ref };
}

// Opens a pull request from branch into base, ready for review.
export async function createPullRequest(
  token: string,
  repo: string,
  pull: { title: string; body: string; branch: string; base: string },
) {
  const res = await fetch(`${GITHUB_API_URL}/repos/${repo}/pulls`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ title: pull.title, body: pull.body, head: pull.branch, base: pull.base }),
  });
  if (!res.ok) throw await apiError("Opening the pull request", res);
  return toPullRequest((await res.json()) as GitHubPull);
}

// Every page of a list endpoint, following GitHub's Link header.
async function listAll<T>(token: string, url: string, what: string) {
  const items: T[] = [];
  for (let next: string | null = `${url}${url.includes("?") ? "&" : "?"}per_page=100`; next;) {
    const res = await fetch(next, { headers: headers(token) });
    if (!res.ok) throw await apiError(what, res);
    items.push(...(await res.json()) as T[]);
    next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
  }
  return items;
}

type GitHubUser = { login: string } | null;

// A GraphQL call, for what the REST API lacks: review threads and resolving them.
async function graphql<T>(token: string, query: string, variables: Record<string, unknown>, what: string) {
  const res = await fetch(`${GITHUB_API_URL}/graphql`, { method: "POST", headers: headers(token), body: JSON.stringify({ query, variables }) });
  if (!res.ok) throw await apiError(what, res);
  const body = await res.json() as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length || !body.data) throw new Error(`${what} failed: ${body.errors?.map(e => e.message).join(": ") ?? "no data"}`);
  return body.data;
}

// Each review comment's thread, by the comment's id: the thread's id and whether it's resolved.
async function reviewThreads(token: string, repo: string, number: number) {
  type Threads = { nodes: { id: string; isResolved: boolean; comments: { nodes: { databaseId: number }[] } }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null } };
  const [owner, name] = repo.split("/");
  const threads = new Map<number, { threadId: string; resolved: boolean }>();
  let after: string | null = null;
  do {
    const data: { repository: { pullRequest: { reviewThreads: Threads } } } = await graphql(token, `query($owner: String!, $name: String!, $number: Int!, $after: String) {
      repository(owner: $owner, name: $name) { pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) { nodes { id isResolved comments(first: 100) { nodes { databaseId } } } pageInfo { hasNextPage endCursor } }
      } } }`, { owner, name, number, after }, "Reading the pull request's review threads");
    const page = data.repository.pullRequest.reviewThreads;
    for (const thread of page.nodes) for (const comment of thread.comments.nodes) threads.set(comment.databaseId, { threadId: thread.id, resolved: thread.isResolved });
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return threads;
}

// A pull request with its whole conversation, oldest first: comments, reviews, and
// review comments on lines of the diff (replyTo is the comment a reply answers, and
// threadId the thread to resolve).
export async function readPullRequestThread(token: string, repo: string, number: number) {
  const base = `${GITHUB_API_URL}/repos/${repo}`;
  const [pull, comments, reviews, reviewComments, threads] = await Promise.all([
    getPullRequest(token, repo, number),
    listAll<{ user: GitHubUser; body: string; created_at: string }>(token, `${base}/issues/${number}/comments`, "Reading the pull request's comments"),
    listAll<{ user: GitHubUser; body: string | null; state: string; submitted_at: string | null }>(token, `${base}/pulls/${number}/reviews`, "Reading the pull request's reviews"),
    listAll<{ id: number; user: GitHubUser; body: string; created_at: string; path: string; line: number | null; original_line: number | null; in_reply_to_id?: number }>(
      token, `${base}/pulls/${number}/comments`, "Reading the pull request's review comments"),
    reviewThreads(token, repo, number),
  ]);
  const thread = [
    ...comments.map(c => ({ type: "comment" as const, author: c.user?.login ?? null, at: c.created_at, body: c.body })),
    ...reviews.filter(r => r.submitted_at).map(r => ({ type: "review" as const, author: r.user?.login ?? null, at: r.submitted_at!, state: r.state, body: r.body ?? "" })),
    ...reviewComments.map(c => ({ type: "review_comment" as const, id: c.id, author: c.user?.login ?? null, at: c.created_at,
      path: c.path, line: c.line ?? c.original_line, outdated: c.line === null, replyTo: c.in_reply_to_id ?? null, ...threads.get(c.id), body: c.body })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return { ...pull, thread };
}

// Comments on the pull request's conversation, or with replyTo (a review comment's id),
// replies in that review comment's thread. Returns the new comment's URL.
export async function commentOnPullRequest(token: string, repo: string, number: number, body: string, replyTo?: number) {
  const url = replyTo === undefined
    ? `${GITHUB_API_URL}/repos/${repo}/issues/${number}/comments`
    : `${GITHUB_API_URL}/repos/${repo}/pulls/${number}/comments/${replyTo}/replies`;
  const res = await fetch(url, { method: "POST", headers: headers(token), body: JSON.stringify({ body }) });
  if (!res.ok) throw await apiError(replyTo === undefined ? "Commenting on the pull request" : "Replying to the review comment", res);
  return ((await res.json()) as { html_url: string }).html_url;
}

// Resolves a review thread (threadId from readPullRequestThread), or reopens it.
export async function resolveReviewThread(token: string, threadId: string, resolved: boolean) {
  const mutation = resolved ? "resolveReviewThread" : "unresolveReviewThread";
  const data = await graphql<Record<string, { thread: { isResolved: boolean } }>>(token,
    `mutation($threadId: ID!) { ${mutation}(input: { threadId: $threadId }) { thread { isResolved } } }`,
    { threadId }, resolved ? "Resolving the review thread" : "Reopening the review thread");
  return data[mutation]!.thread.isResolved;
}
