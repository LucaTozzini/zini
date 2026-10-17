import type { AgentCheck } from "../../../harness/types.js";

type Review = { checks?: { id: string; status: string; note: string }[] } | null;

// A correct PR on a repo whose lint already fails, in a file the PR doesn't touch
// (src/legacyImport.ts). The reviewer should pass every check, saying lint was already
// failing, rather than failing the change for code outside it.
const check: AgentCheck = async ({ document }) => {
  const failures: string[] = [];
  const review = document as Review;
  if (!review?.checks) failures.push("The reviewer didn't submit a review");
  else {
    const failed = review.checks.filter((entry) => entry.status === "failed");
    if (failed.length) failures.push(`Expected no failed checks, got: ${JSON.stringify(failed)}`);
    const code = review.checks.find((entry) => entry.id === "Q5");
    if (!code || !/lint/i.test(code.note) || !/already|before|pre-?exist/i.test(code.note))
      failures.push(`Expected Q5's note to say lint was already failing, got: ${JSON.stringify(code ?? null)}`);
  }
  return {
    passed: failures.length === 0,
    details: failures.length ? failures.join("\n") : `Passed, with lint reported as already failing: ${review!.checks!.find((entry) => entry.id === "Q5")!.note}`,
  };
};

export default check;
