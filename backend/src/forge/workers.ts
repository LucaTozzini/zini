import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createAgent, createMiddleware, toolStrategy } from "langchain";
import type { ForgePlan, LinearIssueDetails } from "shared";
import { z } from "zod";
import { checkpointer, modelRetry, modelStamp, repairToolCalls, streamConfig, toolErrors } from "../agents/agents.js";
import { compactionMiddleware } from "../agents/compaction.js";
import { npmTools } from "../agents/npmTools.js";
import { developmentEnvironmentContext } from "../core/developmentEnvironment.js";
import { wikiTools } from "../openwiki/wikiTools.js";
import { workspaceContext } from "../workspaces/workspaceIntegration.js";
import { workspaceRevision } from "../workspaces/workspaceFiles.js";
import { CODER_REPORT, REVIEW_REPORT } from "./documents.js";
import { issueText } from "./plan.js";
import { browserTools, commandTools } from "./qaTools.js";
import { forgeModel, outsideAgentRun, working, workerThreadId, type Run } from "./run.js";
import { logTo, openRunLog } from "./runLog.js";
import { serviceTools } from "./serviceTools.js";
import { requireSubmission } from "./submission.js";
import { CODER_PROMPT, REVIEWER_PROMPT } from "./systemPrompts.js";
import { conflictTools, diffTool, workspaceFilesystem, writeTools } from "./tools.js";

// The Lead's workers: the Coder and the Reviewer. Each brief runs one to its report (see
// documents.ts), which goes back to the Lead. Both start fresh with every brief, on a
// thread of their own: the workspace, the plan and the Lead's brief carry what came
// before. Each run is logged (see runLog.ts). Commands run in the Docker sandbox.

export type Worker<S extends z.ZodObject> = {
  role: "coder" | "reviewer";
  prompt: string;
  tools: StructuredToolInterface[];
  schema: S;
  // What's wrong with a submitted report, or nothing if it's valid.
  validate?: (report: z.infer<S>) => string | undefined | Promise<string | undefined>;
};

// The issue, the workspace and the development variables, for a worker's system prompt.
async function context(issueId: string, issue: LinearIssueDetails) {
  return [
    `# The Linear issue\n\n${issueText(issue)}`,
    `# Workspace starting point\n\n${JSON.stringify(await workspaceContext(issueId))}`,
    `# Configured development variable names (values are private)\n\n${await developmentEnvironmentContext()}`,
  ].join("\n\n");
}

// The Coder for the approved plan, which it sees afresh with every brief (the plan may
// have changed since its last one) and reports its steps' progress against.
export async function coderWorker(run: Run, issue: LinearIssueDetails, plan: ForgePlan): Promise<Worker<typeof CODER_REPORT>> {
  const { issueId, notify } = run;
  const ids = plan.steps.map((step) => step.id);
  const steps =
    plan.steps.map((step) => `- ${step.id} [${step.status}] ${step.description}`).join("\n") || "No implementation steps.";
  return {
    role: "coder",
    prompt: `${CODER_PROMPT}\n\n${await context(issueId, issue)}\n\n# The approved plan's steps\n\n${steps}`,
    tools: [
      ...writeTools(issueId, notify),
      diffTool(issueId),
      ...conflictTools(issueId, true),
      ...commandTools(issueId),
      ...serviceTools(issueId),
      ...npmTools,
      ...wikiTools,
    ],
    schema: CODER_REPORT,
    validate: (report) => {
      const unknown = report.steps.filter(({ id }) => !ids.includes(id)).map(({ id }) => id);
      if (unknown.length)
        return `Report statuses only for the plan's steps (${ids.join(", ") || "none"}); unknown: ${unknown.join(", ")}`;
    },
  };
}

// The Reviewer for the plan's QA checklist. Shared by the Lead and agent evals.
export async function reviewerWorker(
  run: Pick<Run, "issueId" | "notify">,
  issue: LinearIssueDetails,
  plan: ForgePlan,
): Promise<Worker<typeof REVIEW_REPORT>> {
  const { issueId, notify } = run;
  const revision = await workspaceRevision(issueId);
  const ids = plan.qaChecklist.map((check) => check.id);
  const checklist = plan.qaChecklist.map((check) => `- ${check.id}: ${check.condition}`).join("\n");
  return {
    role: "reviewer",
    prompt: `${REVIEWER_PROMPT}\n\n${await context(issueId, issue)}\n\n# The QA checklist\n\n${checklist}`,
    tools: [
      diffTool(issueId),
      ...commandTools(issueId),
      ...browserTools(issueId, notify),
      ...serviceTools(issueId),
      ...npmTools,
      ...wikiTools,
    ],
    schema: REVIEW_REPORT,
    validate: async (review) => {
      const given = review.checks.map((check) => check.id);
      const missing = ids.filter((id) => !given.includes(id));
      if (missing.length) return `Give a result for every QA check; missing: ${missing.join(", ")}`;
      const unknown = given.filter((id, i) => !ids.includes(id) || given.indexOf(id) !== i);
      if (unknown.length) return `Give one result per QA check id from the checklist; unknown or repeated: ${unknown.join(", ")}`;
      const unexplained = review.checks.filter((check) => check.status !== "passed" && !check.note.trim());
      if (unexplained.length)
        return `Explain each failed or skipped check in its note: ${unexplained.map((check) => check.id).join(", ")}`;
      if ((await workspaceRevision(issueId)) !== revision)
        return "The workspace's source changed during the review. Restore it: you don't edit source files; report the problem instead";
    },
  };
}

// Runs a worker on a brief to its report, on thread (the brief's own, for the Lead).
// history is for agent evals: a conversation to start from.
export async function runWorker<S extends z.ZodObject>(
  { setup, issueId, notify, signal, execution }: Run,
  { role, prompt, tools, schema, validate }: Worker<S>,
  brief: string,
  { thread = workerThreadId(issueId, role), history = [] }: { thread?: string; history?: BaseMessage[] } = {},
): Promise<z.infer<S>> {
  const log = await openRunLog(issueId, role);
  await log.write({ event: "start", role, model: setup.model, prompt, input: brief });
  const model = forgeModel(setup);
  const agent = createAgent({
    model,
    tools,
    systemPrompt: prompt,
    responseFormat: toolStrategy(schema),
    checkpointer,
    // modelRetry is outside logTo, so the log shows each failed attempt.
    middleware: [
      createMiddleware({
        name: "DrainForgeTools",
        wrapToolCall: (request, handler) =>
          execution.track(async () => {
            signal?.throwIfAborted();
            return handler(request);
          }),
      }),
      modelRetry,
      logTo(log),
      modelStamp(setup.model),
      toolErrors,
      repairToolCalls,
      workspaceFilesystem(issueId, role === "coder", notify),
      requireSubmission(String(schema.meta()?.title), (attempt) => log.write({ event: "doc_recovery", attempt })),
      compactionMiddleware(model),
    ],
  });
  // Runs the agent on these new messages to its report. Plenty of steps: the coder may
  // read and edit many files.
  const respond = (messages: BaseMessage[]) =>
    outsideAgentRun(async () => {
      let result: { structuredResponse?: z.infer<S> } = {};
      for await (const state of await agent.stream({ messages }, streamConfig(thread, 300, signal))) {
        result = state as typeof result;
        notify();
      }
      signal?.throwIfAborted();
      // requireSubmission keeps the agent going until it submits, or fails the run.
      if (!result.structuredResponse) throw new Error(`The ${role} ended without its report`);
      return result.structuredResponse;
    });
  working.set(issueId, role);
  notify();
  try {
    let report = await respond([...history, new HumanMessage({ content: brief, additional_kwargs: { username: "Lead" } })]);
    // A report that breaks a rule its schema can't express goes back with the error.
    for (let attempt = 1, error = await validate?.(report); error; attempt++, error = await validate?.(report)) {
      await log.write({ event: "doc_invalid", error });
      if (attempt > 2) throw new Error(`The ${role} submitted an invalid report three times: ${error}`);
      report = await respond([new HumanMessage(`Your report was invalid: ${error}. Submit it again.`)]);
    }
    await log.write({ event: "end", outcome: "done", document: report });
    return report;
  } catch (err) {
    await log.write({ event: "end", outcome: "error", error: String(err) });
    throw err;
  } finally {
    working.delete(issueId);
    notify();
  }
}
