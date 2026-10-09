export const OPENROUTER_URL = "https://openrouter.ai/api/v1";

// true if OpenRouter accepts the key, false if it rejects it (401).
// Other failures are thrown, since they say nothing about the key.
export async function testOpenRouterKey(apiKey: string) {
  const res = await fetch(`${OPENROUTER_URL}/key`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401) return false;
  if (!res.ok) throw new Error(`OpenRouter key check failed: ${res.status}`);
  return true;
}
