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
