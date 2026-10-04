import type { AcceptanceCriterion, ChecksDocument, QaDocument, RepoCommand } from "shared";

type Fingerprint = (path: string) => Promise<string | null>;
export type Runbook = Record<string, RepoCommand & { sourceHashes: Record<string, string> }>;

export function canReuseCheckSelection(
  selection: { commands: RepoCommand[]; blockingQuestions: string[] } | null | undefined,
  book: Runbook,
): boolean {
  return !!selection && !selection.blockingQuestions.length && !!selection.commands.length &&
    selection.commands.every((entry) => {
      const current = book[entry.id.trim().toLowerCase()];
      return current?.kind === "check" && current.command === entry.command && current.cwd === entry.cwd;
    });
}

export async function freshRunbook(book: Runbook, fingerprint: Fingerprint): Promise<Runbook> {
  const entries = await Promise.all(Object.entries(book).map(async ([key, value]) => {
    const hashes = await Promise.all(value.sources.map((path) => fingerprint(path).catch(() => null)));
    return hashes.every((hash, i) => hash !== null && hash === value.sourceHashes[value.sources[i]!])
      ? [key, value] as const : null;
  }));
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

export async function updateRunbook(book: Runbook, updates: RepoCommand[], fingerprint: Fingerprint) {
  const entries = new Map(Object.entries(await freshRunbook(book, fingerprint)));
  for (const update of updates) {
    const id = update.id.trim().toLowerCase();
    const sources = [...new Set(update.sources)];
    if (!id || !sources.length) continue;
    const hashes = await Promise.all(sources.map((path) => fingerprint(path).catch(() => null)));
    if (hashes.some((hash) => hash === null)) continue;
    entries.delete(id);
    entries.set(id, { ...update, id, sources, sourceHashes: Object.fromEntries(sources.map((path, i) => [path, hashes[i]!])) });
    if (entries.size > 16) entries.delete(entries.keys().next().value!);
  }
  return Object.fromEntries(entries);
}

export function runbookText(book: Runbook, report?: ChecksDocument | null) {
  return Object.values(book).map(({ id, kind, command, cwd, purpose, sources }) => {
    const previous = report?.results.find((result) => result.command === command && result.cwd === cwd);
    const status = previous ? `last ${previous.status} on ${report!.revision.slice(0, 12)}` : "discovered, not yet executed";
    return `- ${id} [${kind}, ${status}]: ${command}\n  cwd: ${cwd}; purpose: ${purpose}; sources: ${sources.join(", ")}`;
  }).join("\n");
}

export function checksText(report: ChecksDocument | null) {
  if (!report) return "No checks have run.";
  return [`Workspace version: ${report.revision}; complete: ${report.complete}`,
    ...report.results.map((result) => `${result.status}: ${result.command} (cwd ${result.cwd}, exit ${result.exitCode})\n${result.output}`),
    ...report.couldNotTest.map((reason) => `Could not check: ${reason}`),
    ...(report.notApplicable ?? []).map((reason) => `Not applicable: ${reason}`)].join("\n\n");
}

// A model cannot declare a pass while leaving a requirement unaccounted for.
export function enforceCoverage(report: QaDocument, criteria: AcceptanceCriterion[], checks: ChecksDocument | null): QaDocument {
  const failures = [...report.failures];
  const gaps = [...report.couldNotTest, ...(checks?.couldNotTest ?? [])];
  for (const criterion of criteria) {
    const entries = (report.coverage ?? []).filter((entry) => entry.criterionId === criterion.id);
    if (entries.length !== 1 || !entries[0]!.evidence.trim()) gaps.push(`No unambiguous evidence for ${criterion.id}: ${criterion.requirement}`);
    else if (entries[0]!.status === "blocked") gaps.push(`${criterion.id}: ${entries[0]!.evidence}`);
    else if (entries[0]!.status === "fail") failures.push(`${criterion.id}: ${entries[0]!.evidence}`);
  }
  for (const result of checks?.results ?? []) {
    if (result.status === "failed") failures.push(`${result.command}: ${result.output}`);
    if (result.status === "blocked") gaps.push(`${result.command}: ${result.output}`);
  }
  if (!checks?.complete) gaps.push("Deterministic checks did not complete.");
  return { ...report, failures: [...new Set(failures)], couldNotTest: [...new Set(gaps)],
    verdict: failures.length || report.verdict === "fail" ? "fail" : gaps.length || report.verdict === "partial" ? "partial" : "pass" };
}
