import { z } from "zod";

// The subagents' documents (see shared). Each is also its doc tool (toolStrategy):
// the title is the tool's name and the description tells the model what calling it
// means. The prompts (systemPrompts.ts) name these tools too.

const questions = z
  .array(z.string())
  .describe("Questions for the user you can't decide without; empty if none");

export const REPO_COMMAND = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["check", "start"]),
  command: z.string().min(1).describe("Exact command for the runtime shell; no watch mode for checks"),
  cwd: z.string().describe("Workspace-relative working directory, '.' for the root"),
  purpose: z.string().min(1).max(800).describe("Purpose; for startup, include known prerequisites, env/port/test-data options and readiness/access instructions so QA can use it directly"),
  sources: z.array(z.string().min(1)).min(1).max(5).describe("Only repo files defining this command or its required setup; not incidental implementation/test files or docs"),
});
const runbookUpdates = z.array(REPO_COMMAND).max(16).default([]);
export const ACCEPTANCE_CRITERION = z.object({
  id: z.string().min(1).max(80),
  requirement: z.string().min(1).describe("Observable outcome required by the issue, not an implementation step"),
  source: z.string().min(1).describe("Quote from the issue or user clarification supporting this criterion"),
});

// Durable, source-backed repo findings for the next role. The coordinator records
// file hashes and discards a fact when one of its sources changes.
export const CONTEXT_UPDATES = z
  .array(
    z.object({
      key: z.string().min(1).max(80).describe("Stable topic key; reuse it to correct an earlier fact"),
      fact: z.string().min(1).max(300).describe("One concise, reusable codebase fact"),
      sources: z.array(z.string().min(1)).min(1).max(5).describe("Workspace files that support this fact"),
    }),
  )
  .max(8)
  .describe("New or corrected codebase facts for later roles; empty if nothing durable was learned");

export const PLAN_SCHEMA = z
  .object({
    summary: z.string().describe("The approach, in a few sentences"),
    steps: z
      .array(z.string())
      .describe(
        "Plain instructions, in order, each naming the files it touches",
      ),
    blockingQuestions: questions,
    contextUpdates: CONTEXT_UPDATES.default([]),
    runbookUpdates,
    acceptanceCriteria: z.array(ACCEPTANCE_CRITERION).min(1).max(64),
  })
  .meta({
    title: "submit_plan",
    description:
      "Hand in your plan. Call it once, when you're done reading the code: it ends your turn.",
  });

export const IMPLEMENTATION_SCHEMA = z
  .object({ blockingQuestions: questions, contextUpdates: CONTEXT_UPDATES.default([]), runbookUpdates })
  .meta({
    title: "submit_implementation",
    description:
      "Hand in your work. Call it once, when your changes are made: it ends your turn.",
  });

export const REVIEW_SCHEMA = z
  .object({
    requiredChanges: z
      .array(z.string())
      .describe(
        "What the coder must change, each naming the file and line; empty if none",
      ),
    blockingQuestions: questions,
    contextUpdates: CONTEXT_UPDATES.default([]),
    runbookUpdates,
    environmentFailures: z.array(z.object({ command: z.string(), reason: z.string().min(1) })).default([])
      .describe("Failed checks proven to be missing environment prerequisites, not defects; identify the exact command and evidence"),
  })
  .meta({
    title: "submit_review",
    description:
      "Hand in your review. Call it once, when you're done checking the changes: it ends your turn.",
  });

export const QA_SCHEMA = z
  .object({
    verdict: z
      .enum(["pass", "fail", "partial"])
      .describe("fail for a proven defect, partial for untested requirements, pass only when all criteria are covered"),
    checks: z
      .array(z.string())
      .describe("Brief execution summary; put per-criterion evidence in coverage rather than repeating it here"),
    failures: z
      .array(z.string())
      .describe(
        "What doesn't work because of the changes, each with how to reproduce it and the evidence (e.g. the error); empty if none",
      ),
    couldNotTest: z
      .array(z.string())
      .describe(
        "Only requested acceptance criteria you could not verify, and why (e.g. missing credentials or rejected commands). Manual product checks count as verification. Do not list absent automated UI tests when manually covered, or unrequested accessibility/style checks. Empty if every requested criterion was verified.",
      ),
    blockingQuestions: questions,
    contextUpdates: CONTEXT_UPDATES.default([]),
    runbookUpdates,
    coverage: z.array(z.object({
      criterionId: z.string(),
      status: z.enum(["pass", "fail", "blocked"]),
      evidence: z.string().min(1).describe("Concrete observation or tool result, or why this criterion could not be tested"),
    })),
  })
  .meta({
    title: "submit_qa_report",
    description:
      "Hand in your QA report. Call it once, when you're done testing: it ends your turn.",
  });

export const CHECKS_SCHEMA = z.object({
  commands: z.array(REPO_COMMAND).max(16).describe("Relevant finite checks in execution order; no duplicates or servers"),
  couldNotTest: z.array(z.string()).describe("Configured relevant checks you cannot execute or their missing prerequisites, with the reason. A category with no repo-configured command goes in notApplicable, not here. Product QA handles behavioral coverage. Empty if none"),
  notApplicable: z.array(z.string()).default([]).describe("Evidence that a category of checks does not apply to this task/repo; absence is distinct from a check that could not run"),
  blockingQuestions: questions,
  contextUpdates: CONTEXT_UPDATES.default([]),
  runbookUpdates,
}).meta({
  title: "submit_checks",
  description: "Submit the selected commands. The coordinator executes them and records their real results.",
});
