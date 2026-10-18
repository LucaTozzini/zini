import { z } from "zod";

// What the workers hand back to the Lead. Each is also its doc tool (toolStrategy): the
// title is the tool's name and the description tells the model what calling it means.
// The prompts (systemPrompts.ts) name these tools too.

const questions = z.array(z.string()).describe("Questions for the Lead you can't decide without; empty if none");

export const CODER_REPORT = z
  .object({
    report: z
      .string()
      .min(1)
      .describe("What you changed and where, and anything the Lead should know (e.g. something you couldn't do)"),
    steps: z
      .array(
        z.object({
          id: z.string().describe("The plan step's id, e.g. S1"),
          status: z.enum(["todo", "in-progress", "complete"]),
        }),
      )
      .describe(
        "The status of each plan step you worked on: complete when it's fully done, in-progress when it's partly done; empty if none",
      ),
    questions,
  })
  .meta({
    title: "submit_work",
    description: "Hand your work back to the Lead. Call it once, when your changes are made: it ends your turn.",
  });

export const REVIEW_REPORT = z
  .object({
    checks: z
      .array(
        z.object({
          id: z.string().describe("The QA check's id, e.g. Q1"),
          status: z
            .enum(["passed", "failed", "skipped"])
            .describe("skipped only when your tools can't verify it here (no change to the code could make it testable)"),
          note: z.string().describe("For failed: how to reproduce it and the evidence. For skipped: why. Optional for passed"),
        }),
      )
      .describe("One entry per QA check"),
    findings: z
      .array(z.string())
      .describe(
        "Problems you noticed outside the checklist (bugs, regressions, risky code), each naming the file; empty if none. They don't block finishing: the Lead decides",
      ),
    questions,
  })
  .meta({
    title: "submit_review",
    description: "Hand your review back to the Lead. Call it once, when every QA check has a result: it ends your turn.",
  });
