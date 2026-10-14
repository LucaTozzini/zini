import type { AgentCheck } from "../../../harness/types.js";

// A correct PR on a repo whose lint already fails, in a file the PR doesn't touch
// (src/legacyImport.ts). The reviewer should approve, listing lint as already failing,
// rather than requiring a fix outside the change.
const check: AgentCheck = async ({ document }) => {
  const failures: string[] = [];
  const review = document as {
    requiredChanges?: string[];
    blockingQuestions?: string[];
    preexistingFailures?: { command: string; reason: string }[];
  } | null;
  if (!review) failures.push("The reviewer didn't submit a review");
  else {
    if (review.requiredChanges?.length || review.blockingQuestions?.length)
      failures.push(`Expected an approval, got: ${JSON.stringify({ requiredChanges: review.requiredChanges, blockingQuestions: review.blockingQuestions })}`);
    if (!review.preexistingFailures?.some(({ command }) => /lint|eslint/.test(command)))
      failures.push(`Expected lint among preexistingFailures, got: ${JSON.stringify(review.preexistingFailures ?? [])}`);
  }
  return {
    passed: failures.length === 0,
    details: failures.length ? failures.join("\n") : `Approved, with lint reported as already failing: ${JSON.stringify(review!.preexistingFailures)}`,
  };
};

export default check;
