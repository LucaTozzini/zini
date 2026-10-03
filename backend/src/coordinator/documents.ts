import { z } from "zod";

// The subagents' documents (see shared). Each is also its doc tool (toolStrategy):
// the title is the tool's name and the description tells the model what calling it
// means. The prompts (systemPrompts.ts) name these tools too.

const questions = z
  .array(z.string())
  .describe("Questions for the user you can't decide without; empty if none");

export const PLAN_SCHEMA = z
  .object({
    summary: z.string().describe("The approach, in a few sentences"),
    steps: z
      .array(z.string())
      .describe(
        "Plain instructions, in order, each naming the files it touches",
      ),
    blockingQuestions: questions,
  })
  .meta({
    title: "submit_plan",
    description:
      "Hand in your plan. Call it once, when you're done reading the code: it ends your turn.",
  });

export const IMPLEMENTATION_SCHEMA = z
  .object({ blockingQuestions: questions })
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
  })
  .meta({
    title: "submit_review",
    description:
      "Hand in your review. Call it once, when you're done checking the changes: it ends your turn.",
  });

export const QA_SCHEMA = z
  .object({
    verdict: z
      .enum(["pass", "fail"])
      .describe("fail if anything in failures; pass otherwise"),
    checks: z
      .array(z.string())
      .describe("What you ran or tried, each with its result"),
    failures: z
      .array(z.string())
      .describe(
        "What doesn't work because of the changes, each with how to reproduce it and the evidence (e.g. the error); empty if none",
      ),
    couldNotTest: z
      .array(z.string())
      .describe(
        "What you couldn't check, and why (e.g. a missing .env, a command the user rejected); empty if none",
      ),
    blockingQuestions: questions,
  })
  .meta({
    title: "submit_qa_report",
    description:
      "Hand in your QA report. Call it once, when you're done testing: it ends your turn.",
  });
