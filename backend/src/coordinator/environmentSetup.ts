import type { Decision, EnvironmentSetupDocument, RepoCommand } from "shared";

export type SetupSelection = { commands: RepoCommand[]; noSetupReason?: string; blockingQuestions: string[] };

export function validateEnvironmentSetup(selection: SetupSelection) {
  if (selection.blockingQuestions.length) return;
  if (selection.commands.some((entry) => entry.kind !== "setup")) return "Only setup commands belong in environment setup";
  if (Boolean(selection.commands.length) === Boolean(selection.noSetupReason))
    return "Give either setup commands or noSetupReason with repository evidence";
}

// A failure/rejected command stops preparation. Later checks must never run against
// an environment that was only partially prepared. Retrying requires a human answer
// and a fresh selection/approval, rather than an automatic failing-command loop.
export async function executeEnvironmentSetup(selection: SetupSelection, decisions: Decision[], revision: string,
  execute: (entry: RepoCommand, index: number) => Promise<{ exitCode: number | null; timedOut?: boolean; status: string; output: string }>,
  signal?: AbortSignal): Promise<EnvironmentSetupDocument> {
  const invalid = validateEnvironmentSetup(selection);
  if (invalid || selection.blockingQuestions.length) throw new Error(invalid ?? "Setup has unanswered questions");
  const report: EnvironmentSetupDocument = { revision, complete: false, results: [], noSetupReason: selection.noSetupReason, blockingQuestions: [] };
  for (const [index, entry] of selection.commands.entries()) {
    signal?.throwIfAborted();
    const decision = decisions[index];
    let result;
    if (decision?.type !== "approve") result = { exitCode: null, status: "blocked", output: decision?.type === "reject" ? decision.message ?? "Setup command rejected" : "Setup command not approved" };
    else {
      try {
        const actual = await execute(entry, index);
        signal?.throwIfAborted();
        result = { exitCode: actual.exitCode, status: actual.exitCode === 0 && !actual.timedOut ? "passed" : "blocked", output: `${actual.status}\n${actual.output}` };
      } catch (error) {
        signal?.throwIfAborted();
        result = { exitCode: null, status: "blocked", output: String(error) };
      }
    }
    report.results.push({ command: entry.command, cwd: entry.cwd, purpose: entry.purpose, ...result, status: result.status as "passed" | "blocked" });
    if (result.status !== "passed") {
      report.results.push(...selection.commands.slice(index + 1).map((pending) => ({
        command: pending.command, cwd: pending.cwd, purpose: pending.purpose,
        status: "blocked" as const, exitCode: null, output: "Not run: an earlier setup prerequisite did not complete.",
      })));
      report.blockingQuestions.push(`Environment setup could not complete: [${entry.cwd}] ${entry.command}. ${result.output}\nWhat should change before retrying setup?`);
      return report;
    }
  }
  report.complete = true;
  return report;
}

export const environmentSetupNext = (report: EnvironmentSetupDocument | null) =>
  report?.complete && !report.blockingQuestions.length ? "checks" : "ask_setup_failure";
