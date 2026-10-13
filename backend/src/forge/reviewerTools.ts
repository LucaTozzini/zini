import { tool } from "langchain";
import { z } from "zod";
import type { ChecksDocument, ReviewDocument } from "shared";
import { REPO_COMMAND } from "./documents.js";
import { QUIET_SECONDS, quietSeconds, runCommandResult } from "./qaProcesses.js";

export class ReviewEvidence {
  results: ChecksDocument["results"];
  private operations = 0;
  constructor(previous: ChecksDocument | null, readonly revision: string) {
    this.results = previous?.revision === revision ? [...previous.results] : [];
  }
  validate(review: ReviewDocument & { noChecksReason?: string }) {
    if (review.blockingQuestions.length || review.requiredChanges.length) return;
    if (!this.results.length && !review.noChecksReason) return "Run relevant checks using run_check, or provide a source-backed noChecksReason before approving.";
    if (this.results.length && review.noChecksReason) return "Checks were executed; omit noChecksReason.";
    const unresolved = this.results.find(result => result.status !== "passed");
    if (unresolved) return `Cannot approve with an unexplained ${unresolved.status} check: ${unresolved.command}. Repair environment prerequisites and rerun, or report requiredChanges or blockingQuestions.`;
  }
  report(noChecksReason?: string): ChecksDocument {
    return { revision: this.revision, complete: true, results: this.results, ...(noChecksReason ? { noChecksReason } : {}) };
  }
  budget() {
    if (++this.operations > 32) throw new Error("Reviewer command budget exhausted. Submit concrete defects, environment failures or blockingQuestions with the recorded evidence.");
  }
  record(result: ChecksDocument["results"][number]) {
    const index = this.results.findIndex(previous => previous.command === result.command && previous.cwd === result.cwd);
    if (index === -1) this.results.push(result); else this.results[index] = result;
  }
}

export function reviewerTools(id: string, evidence: ReviewEvidence) {
  return [tool(async ({ entry, timeoutSeconds, quietSeconds, rerun }, config) => {
    evidence.budget();
    const previous = evidence.results.find(result => result.command === entry.command && result.cwd === entry.cwd);
    if (previous?.status === "passed" && !rerun) return { ...previous, reused: true };
    let result: ChecksDocument["results"][number];
    try {
      const actual = await runCommandResult(id, entry.command, entry.cwd, timeoutSeconds ?? 300, config.signal, quietSeconds ?? QUIET_SECONDS);
      result = { command: entry.command, cwd: entry.cwd, purpose: entry.purpose,
        status: actual.timedOut || actual.exitCode === null ? "blocked" : actual.exitCode === 0 ? "passed" : "failed",
        exitCode: actual.exitCode, output: `${actual.status}\n${actual.output}` };
    } catch (error) {
      config.signal?.throwIfAborted();
      result = { command: entry.command, cwd: entry.cwd, purpose: entry.purpose, status: "blocked", exitCode: null, output: String(error) };
    }
    evidence.record(result);
    return result;
  }, { name: "run_check", description: "Execute a finite repository test, lint, typecheck, build or diagnostic and inspect its real exit code/output. Commands run inside the prepared workspace. Recorded commands are reused; set rerun only after addressing the observed cause. No implementation edits, Git mutations, installations, migrations, seeds, watch mode or persistent servers; use run_setup and service tools for environment preparation.",
    schema: z.object({ entry: REPO_COMMAND.extend({ kind: z.literal("check") }), timeoutSeconds: z.number().int().min(1).max(1800).optional(), quietSeconds, rerun: z.boolean().optional() }) })];
}
