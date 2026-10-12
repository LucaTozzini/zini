import type { AgentCheck } from "../../../harness/types.js";

// The reviewer's first review of an inherited PR whose store tidy-up breaks a server test.
// It should request changes for the TodoStore.update regression without starting the
// slow, broader app suite (npm run test:ui): the focused checks have already failed.
const isUi = (command: string) => /test:ui|vitest\.ui\.config/.test(command);

const check: AgentCheck = async ({ log, document }) => {
  const failures: string[] = [];
  const review = document as { requiredChanges?: string[]; blockingQuestions?: string[] } | null;
  if (!review) failures.push("The reviewer didn't submit a review");
  else if (!review.requiredChanges?.some((change) => /store/i.test(change) && /update|null|undefined/i.test(change)))
    failures.push(`Expected a requested change for TodoStore.update, got: ${JSON.stringify(review)}`);

  const commandOf = (args: unknown) => String((args as { entry?: { command?: string } } | undefined)?.entry?.command ?? "");
  const started = log
    .filter((e) => e.event === "tool_call" && e.name === "run_check")
    .map((e) => ({ t: e.t, command: commandOf((e as { args: unknown }).args) }));
  if (started.some(({ command }) => isUi(command))) failures.push("npm run test:ui was started although the focused checks failed");

  return {
    passed: failures.length === 0,
    details: `${failures.length ? failures.join("\n") : "Requested the store fix without starting the slow app suite."}\nChecks started: ${started.map(({ t, command }) => `${t.slice(11, 19)} ${command}`).join("; ") || "none"}`,
  };
};

export default check;
