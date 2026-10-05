import type { z } from "zod";
import type { CONTEXT_UPDATES } from "./documents.js";

export type ContextUpdate = z.infer<typeof CONTEXT_UPDATES>[number];

export type CodebaseFact = ContextUpdate & {
  // Captured when the fact was written. A changed or missing source invalidates it.
  sourceHashes: Record<string, string>;
};

export type CodebaseContext = Record<string, CodebaseFact>;
type Fingerprint = (path: string) => Promise<string | null>;

const MAX_FACTS = 20;

export async function freshContext(context: CodebaseContext, fingerprint: Fingerprint): Promise<CodebaseContext> {
  const fresh = new Map<string, CodebaseFact>();
  for (const fact of Object.values(context)) {
    if (
      fact.sources.length > 0 &&
      (await Promise.all(fact.sources.map((source) => fingerprint(source).catch(() => null))))
        .every((hash, i) => hash !== null && hash === fact.sourceHashes[fact.sources[i]!])
    ) {
      fresh.set(fact.key, fact);
    }
  }
  return Object.fromEntries(fresh);
}

// Upsert by topic key. Invalid paths are ignored rather than poisoning the next role's
// prompt, and the oldest facts are evicted if the context fills up.
export async function updateContext(
  context: CodebaseContext,
  updates: ContextUpdate[],
  fingerprint: Fingerprint,
): Promise<CodebaseContext> {
  const facts = new Map(Object.entries(await freshContext(context, fingerprint)));
  for (const update of updates) {
    const key = update.key.trim().toLowerCase();
    const fact = update.fact.trim();
    const sources = [...new Set(update.sources.map((source) => source.trim().replaceAll("\\", "/")))];
    if (!key || !fact || sources.length === 0) continue;
    const hashes = await Promise.all(sources.map((source) => fingerprint(source).catch(() => null)));
    if (hashes.some((hash) => hash === null)) continue;
    facts.delete(key);
    facts.set(key, {
      key,
      fact,
      sources,
      sourceHashes: Object.fromEntries(sources.map((source, i) => [source, hashes[i]!])),
    });
    if (facts.size > MAX_FACTS) facts.delete(facts.keys().next().value!);
  }
  return Object.fromEntries(facts);
}

export function contextText(context: CodebaseContext) {
  const facts = Object.values(context);
  return facts.length
    ? facts.map(({ key, fact, sources }) => `- ${key}: ${fact} (${sources.join(", ")})`).join("\n")
    : "";
}
