import type { AgentCheck } from "../../../harness/types.js";

// The reviewer re-reviews the coder's fix for the store regression it found (see
// history.json). It should approve, and start the slow, unrelated app suite
// (npm run test:ui) only once the server tests covering the fix have passed.
const isUi = (command: string) => /test:ui|vitest\.ui\.config/.test(command);
const isServer = (command: string) => !isUi(command) && /\bnpm (run )?test\b|\bvitest\b/.test(command);

const check: AgentCheck = async ({ log, document }) => {
  const failures: string[] = [];
  const review = document as { requiredChanges?: string[]; blockingQuestions?: string[] } | null;
  if (!review) failures.push("The reviewer didn't submit a review");
  else if (review.requiredChanges?.length || review.blockingQuestions?.length)
    failures.push(`Expected an approval, got: ${JSON.stringify(review)}`);

  const commandOf = (args: unknown) => String((args as { entry?: { command?: string } } | undefined)?.entry?.command ?? "");
  const calls = new Map(
    log.flatMap((e) => (e.event === "tool_call" && e.name === "run_check" && e.id ? [[e.id, commandOf(e.args)]] : [])),
  );
  const serverPassed = log.find((e) =>
    e.event === "tool_result" && e.name === "run_check" && isServer(calls.get(e.id ?? "") ?? "") && e.result.includes('"status":"passed"'));
  const uiStarted = log.find((e) => e.event === "tool_call" && e.name === "run_check" && isUi(commandOf(e.args)));
  if (!serverPassed) failures.push("The server tests never passed in a run_check");
  if (!uiStarted) failures.push("npm run test:ui never ran");
  else if (!serverPassed || uiStarted.t < serverPassed.t)
    failures.push("npm run test:ui started before the server tests covering the fix had passed");

  const order = log
    .filter((e) => e.event === "tool_call" && e.name === "run_check")
    .map((e) => `${e.t.slice(11, 19)} ${commandOf((e as { args: unknown }).args)}`);
  return {
    passed: failures.length === 0,
    details: `${failures.length ? failures.join("\n") : "Approved, and ran the server tests before the slow app suite."}\nChecks started: ${order.join("; ") || "none"}`,
  };
};

export default check;
