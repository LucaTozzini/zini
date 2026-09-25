export const GITHUB_API_URL = "https://api.github.com";

// true if GitHub accepts the token, false if it rejects it (401).
// Other failures are thrown, since they say nothing about the token.
export async function testGitHubKey(token: string) {
  const res = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "zini",
    },
  });
  if (res.status === 401) return false;
  if (!res.ok) throw new Error(`GitHub token check failed: ${res.status}`);
  return true;
}
