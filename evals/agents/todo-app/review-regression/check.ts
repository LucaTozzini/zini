import type { AgentCheck } from "../../../harness/types.js";

type Review = { checks?: { id: string; status: string; note: string }[] } | null;

// The reviewer's first review of an inherited PR whose store tidy-up breaks a server test.
// It should fail a check for the TodoStore.update regression without starting the slow,
// broader app suite (npm run test:ui): the focused checks have already failed.
const isUi = (command: string) => /test:ui|vitest\.ui\.config/.test(command);

const check: AgentCheck = async ({ log, document }) => {
  const failures: string[] = [];
  const review = document as Review;
  if (!review?.checks) failures.push("The reviewer didn't submit a review");
  else if (!review.checks.some((entry) => entry.status === "failed" && /store/i.test(entry.note) && /update|null|undefined/i.test(entry.note)))
    failures.push(`Expected a failed check for TodoStore.update, got: ${JSON.stringify(review.checks)}`);

  const commandOf = (args: unknown) => String((args as { command?: string } | undefined)?.command ?? "");
  const started = log
    .filter((e) => e.event === "tool_call" && e.name === "run_command")
    .map((e) => ({ t: e.t, command: commandOf((e as { args: unknown }).args) }));
  if (started.some(({ command }) => isUi(command))) failures.push("npm run test:ui was started although the focused checks failed");

  return {
    passed: failures.length === 0,
    details: `${failures.length ? failures.join("\n") : "Failed the store regression without starting the slow app suite."}\nCommands run: ${started.map(({ t, command }) => `${t.slice(11, 19)} ${command}`).join("; ") || "none"}`,
  };
};

export default check;
