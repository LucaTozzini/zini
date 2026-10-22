import { Command, interrupt, StateSchema } from "@langchain/langgraph";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createAgent, createMiddleware, fakeModel, modelCallLimitMiddleware, tool } from "langchain";
import type { AgentRole, ForgePlan, IntegrationState, PendingApproval, ForgeResume, ForgeState, ForgeWaiting } from "shared";
import { z } from "zod";
import {
  checkpointer,
  modelRetry,
  readCheckpointer,
  modelStamp,
  repairToolCalls,
  streamConfig,
  threadConfig,
  toolErrors,
} from "../agents/agents.js";
import { compactionMiddleware } from "../agents/compaction.js";
import { npmTools } from "../agents/npmTools.js";
import { linearFileTools } from "../agents/linearFileTools.js";
import { isRunning, runStatus } from "../agents/runs.js";
import { browserUrl, closeBrowser } from "../browser/agentBrowser.js";
import { fetchLinearIssue } from "../integrations/linear.js";
import { Workspace } from "../models/Workspace.js";
import { wikiTools } from "../openwiki/wikiTools.js";
import { userMessage, withSenderName } from "../projectLead/messageInput.js";
import { hasUncommitted, workspaceChanges, workspaceRevision } from "../workspaces/workspaceFiles.js";
import { commitAndIntegrate, isUpToDate, workspaceContext } from "../workspaces/workspaceIntegration.js";
import { emitForgeEvent, type ForgeLifecycleEvent } from "./events.js";
import { loadForgeHistory } from "./history.js";
import { checkpointMessages, forgeMessages } from "./messages.js";
import { draftPlan, editPlan, issueText, planText, resetChecks, unfinishedPlan } from "./plan.js";
import { forgeEvents } from "./forgeEvents.js";
import { stopAllProcesses } from "./qaProcesses.js";
import { forgeModel, forgeThreadId, working, workerThreadId, type Run } from "./run.js";
import { logTo, openRunLog, type RunLog } from "./runLog.js";
import { LEAD_PROMPT } from "./systemPrompts.js";
import { conflictTools, diffTool, workspaceFilesystem } from "./tools.js";
import { forgeSkillsMiddleware } from "./forgeSkills.js";
import { restartApp } from "../workspaces/appLaunches.js";
import { coderWorker, reviewerWorker, runWorker } from "./workers.js";

export { loadSetup, forgeThreadId, outsideAgentRun, forgeRun, type Run, type Setup } from "./run.js";

// The forge: per issue, a Lead agent that works the issue end to end in its workspace.
// It reads the code, writes the plan (every change to it pauses for your approval),
// delegates the code to the Coder and the testing to the Reviewer (see workers.ts),
// commits (merging the latest default branch each time) and finishes once the plan is
// done. It pauses (interrupt) to ask you questions. You can message it at any time it
// isn't working, e.g. with changes after it finished.

// ---- The Lead's state -------------------------------------------------------------

type LeadState = {
  plan: ForgePlan | null;
  planApproved: boolean;
  finished: boolean;
  integration: IntegrationState | null;
  // The workspace revision the Reviewer last reviewed.
  reviewedRevision: string | null;
};

// The plan and where the work is at, kept with the Lead's conversation. Each model call
// sees the current plan, which also keeps it through compaction.
const leadState = createMiddleware({
  name: "ForgePlan",
  stateSchema: new StateSchema({
    plan: z.custom<ForgePlan | null>().default(null),
    planApproved: z.boolean().default(false),
    finished: z.boolean().default(false),
    integration: z.custom<IntegrationState | null>().default(null),
    reviewedRevision: z.string().nullable().default(null),
  }),
  wrapModelCall: (request, handler) => {
    const { plan, planApproved } = request.state as unknown as LeadState;
    const text = plan
      ? `Revision ${plan.revision}. ${planApproved ? "Approved." : "Not approved yet: the user is reviewing it."}\n\n` +
        `Design:\n${plan.design}\n\n` +
        (plan.mockups.length ? `Mockups: ${plan.mockups.map((mockup) => mockup.title).join(", ")}\n\n` : "") +
        planText(plan)
      : "No plan yet.";
    return handler({ ...request, systemMessage: request.systemMessage.concat(`\n\n# The current plan\n\n${text}`) });
  },
});

// Tools that change the plan or the workspace, or pause for the user, run one at a time:
// a reply that calls one alongside other tools gets an error for each call instead.
const SEQUENTIAL = new Set([
  "write_plan",
  "edit_plan",
  "update_steps",
  "ask_user",
  "delegate_coder",
  "delegate_reviewer",
  "commit",
  "finish",
]);
const oneAtATime = createMiddleware({
  name: "OneAtATime",
  afterModel: (state) => {
    const last = state.messages.at(-1);
    const calls = AIMessage.isInstance(last) ? (last.tool_calls ?? []) : [];
    if (calls.length < 2 || !calls.some((call) => SEQUENTIAL.has(call.name))) return;
    return {
      messages: calls.map(
        (call) =>
          new ToolMessage({
            tool_call_id: call.id!,
            name: call.name,
            status: "error",
            content: `${[...SEQUENTIAL].join(", ")} must each be called alone, not with other tools. Call them one at a time.`,
          }),
      ),
    };
  },
});

// Shows the model who sent each message, from the username saved with it.
const senderNames = createMiddleware({
  name: "SenderNames",
  wrapModelCall: (request, handler) => handler({ ...request, messages: request.messages.map(withSenderName) }),
});

// ---- The Lead's tools -------------------------------------------------------------

type Runtime = { state: LeadState; toolCallId: string };
const runtimeOf = (runtime: unknown) => runtime as Runtime;

// A tool result that also changes the Lead's state.
const updating = (runtime: Runtime, name: string, content: string, update: Partial<LeadState>) =>
  new Command({ update: { ...update, messages: [new ToolMessage({ content, tool_call_id: runtime.toolCallId, name })] } });

// Saves a new revision of the plan, unapproved, for the user to review.
const savePlan = (runtime: Runtime, name: string, plan: ForgePlan) =>
  updating(
    runtime,
    name,
    `Saved plan revision ${plan.revision}, not approved yet. The user reviews it now: their approval or ` +
      "feedback comes as a message. End your turn with one short sentence for them; until it's approved, " +
      "delegate_coder and delegate_reviewer are refused.",
    { plan, planApproved: false, finished: false },
  );

// A step or QA check edit for edit_plan (see plan.ts's ListEdit).
const LIST_EDIT = z.object({
  action: z.enum(["replace", "remove", "insert"]),
  id: z
    .string()
    .optional()
    .describe("The id it changes or removes, or inserts after (as before this edit); insert without it adds at the end"),
  text: z.string().optional().describe("The new text, for replace and insert"),
});

function leadTools(issueId: string, need: () => Run) {
  const issue = () => fetchLinearIssue(need().setup.linear, issueId);
  const approved = (state: LeadState) => {
    if (!state.plan || !state.planApproved) throw new Error("Write a plan and have it approved first (write_plan)");
    return state.plan;
  };
  return [
    tool(
      async ({ design, mockups, steps, qaChecklist }, config) => {
        const runtime = runtimeOf(config);
        return savePlan(runtime, "write_plan", draftPlan(runtime.state.plan, design, mockups ?? [], steps, qaChecklist));
      },
      {
        name: "write_plan",
        description:
          "Save the whole plan for the user to review: the first plan, or a rewrite. For changes to part of it, use " +
          "edit_plan. It doesn't wait: end your turn after it. The plan is unapproved until the user approves it, and " +
          "every change to it needs approval again. Steps and checks whose text is unchanged keep their status.",
        schema: z.object({
          design: z
            .string()
            .min(1)
            .describe(
              "Markdown for the user: the outcome, the approach (components and data flow, alternatives rejected), " +
                "the decisions (each marked issue, user's answer or your call), interfaces (API, data, UI states, copy), " +
                "and risks and what's out of scope",
            ),
          mockups: z
            .array(
              z.object({
                title: z.string().min(1).describe('The screen and state it shows, e.g. "To-do list: empty"'),
                html: z.string().min(1).describe("A standalone HTML document with inline CSS and no scripts"),
              }),
            )
            .optional()
            .describe("Wireframes of the UI the issue adds or changes, one per state the design names; none otherwise"),
          steps: z.array(z.string().min(1)).describe("Concrete implementation steps, in order, each naming the files it touches"),
          qaChecklist: z
            .array(z.string().min(1))
            .min(1)
            .describe("Testable conditions the Reviewer verifies, including code checks"),
        }),
      },
    ),
    tool(
      async (edits, config) => {
        const runtime = runtimeOf(config);
        const previous = runtime.state.plan;
        if (!previous) throw new Error("There's no plan to edit yet: write it with write_plan");
        if (!Object.values(edits).some((list) => list?.length)) throw new Error("Give at least one edit");
        const { design, mockups, steps, qaChecklist } = editPlan(previous, edits);
        if (!qaChecklist.length) throw new Error("The QA checklist can't be empty");
        return savePlan(runtime, "edit_plan", draftPlan(previous, design, mockups, steps, qaChecklist));
      },
      {
        name: "edit_plan",
        description:
          "Change part of the plan, e.g. for the user's feedback, without rewriting the rest: exact text replacements " +
          "in the design, mockups by title, and steps and QA checks by id. The edits apply together, or not at all if " +
          "one doesn't fit. Like write_plan, it saves the next revision unapproved for the user to review: end your " +
          "turn after it. Unchanged steps and checks keep their status.",
        schema: z.object({
          design: z
            .array(
              z.object({
                oldText: z.string().min(1).describe("Text that appears exactly once in the design, copied exactly"),
                newText: z.string().describe("Its replacement; empty removes it"),
              }),
            )
            .optional(),
          mockups: z
            .array(
              z.object({
                title: z.string().min(1),
                html: z
                  .string()
                  .optional()
                  .describe("The whole new HTML, replacing the mockup with this title or adding one; omit to remove it"),
              }),
            )
            .optional(),
          steps: z.array(LIST_EDIT).optional(),
          qaChecklist: z.array(LIST_EDIT).optional(),
        }),
      },
    ),
    tool(
      async ({ updates }, config) => {
        const runtime = runtimeOf(config);
        const plan = approved(runtime.state);
        const unknown = updates.filter(({ id }) => !plan.steps.some((step) => step.id === id));
        if (unknown.length) throw new Error(`No such step: ${unknown.map(({ id }) => id).join(", ")}`);
        const statuses = new Map(updates.map(({ id, status }) => [id, status]));
        const next = { ...plan, steps: plan.steps.map((step) => ({ ...step, status: statuses.get(step.id) ?? step.status })) };
        return updating(runtime, "update_steps", planText(next), { plan: next });
      },
      {
        name: "update_steps",
        description: "Mark plan steps todo, in-progress or complete. Doesn't need approval.",
        schema: z.object({
          updates: z
            .array(
              z.object({
                id: z.string().describe("The step's id, e.g. S1"),
                status: z.enum(["todo", "in-progress", "complete"]),
              }),
            )
            .min(1),
        }),
      },
    ),
    tool(
      async ({ questions }) => {
        const { answers } = interrupt<ForgeWaiting, { answers: string[] }>({ kind: "questions", questions });
        return questions.map((question, i) => `Q: ${question}\nA: ${answers[i] ?? ""}`).join("\n\n");
      },
      {
        name: "ask_user",
        description: "Ask the user questions you can't decide without, and wait for their answers.",
        schema: z.object({ questions: z.array(z.string().min(1)).min(1) }),
      },
    ),
    tool(
      async ({ brief }, config) => {
        const runtime = runtimeOf(config);
        const plan = approved(runtime.state);
        const run = need();
        await emitForgeEvent(issueId, { type: "stage_started", role: "coder" });
        const { steps, ...report } = await runWorker(run, await coderWorker(run, await issue(), plan), brief, {
          thread: workerThreadId(issueId, "coder", runtime.toolCallId),
        });
        // The user's app, if it's running, restarts with the changes.
        void restartApp(issueId);
        const changes = await workspaceChanges(issueId, true);
        const statuses = new Map(steps.map(({ id, status }) => [id, status]));
        const next = { ...plan, steps: plan.steps.map((step) => ({ ...step, status: statuses.get(step.id) ?? step.status })) };
        return updating(
          runtime,
          "delegate_coder",
          JSON.stringify({
            ...report,
            uncommittedChanges: changes.map(({ path }) => path),
            steps: next.steps.map(({ id, status }) => `${id}: ${status}`),
          }),
          { plan: next },
        );
      },
      {
        name: "delegate_coder",
        description:
          "Have the Coder carry out a brief: edit the code (or resolve merge conflicts) and run what it needs to. " +
          "It sees the approved plan's steps and marks the ones it completes. Returns its report, the step statuses and the uncommitted changed files.",
        schema: z.object({
          brief: z
            .string()
            .min(1)
            .describe("Which steps to do, and anything the plan doesn't say: approach, findings to fix, what you learned"),
        }),
      },
    ),
    tool(
      async ({ brief }, config) => {
        const runtime = runtimeOf(config);
        const plan = approved(runtime.state);
        if (await hasUncommitted(issueId)) throw new Error("Commit the changes first: the Reviewer tests committed code");
        const run = need();
        await emitForgeEvent(issueId, { type: "stage_started", role: "reviewer" });
        const reviewedRevision = await workspaceRevision(issueId);
        let review;
        try {
          review = await runWorker(run, await reviewerWorker(run, await issue(), plan), brief, {
            thread: workerThreadId(issueId, "reviewer", runtime.toolCallId),
          });
        } finally {
          await stopForgeProcesses(issueId);
          run.notify();
        }
        const results = new Map(review.checks.map((check) => [check.id, check]));
        const next = {
          ...plan,
          qaChecklist: plan.qaChecklist.map((check) => {
            const result = results.get(check.id);
            return result ? { ...check, status: result.status, note: result.note } : check;
          }),
        };
        return updating(runtime, "delegate_reviewer", JSON.stringify({ ...review, checklist: planText(next) }), {
          plan: next,
          reviewedRevision,
        });
      },
      {
        name: "delegate_reviewer",
        description:
          "Have the Reviewer test the committed code against the QA checklist. It marks every check and reports " +
          "findings outside the checklist. Commit first.",
        schema: z.object({ brief: z.string().min(1).describe("What changed since its last review and what to focus on") }),
      },
    ),
    tool(
      async ({ message }, config) => {
        const runtime = runtimeOf(config);
        const { committed, integration } = await commitAndIntegrate(issueId, message ?? "", need().refreshUpstream);
        const changed = committed || integration.status !== "current";
        const plan = changed && runtime.state.plan ? resetChecks(runtime.state.plan) : runtime.state.plan;
        const result =
          integration.status === "conflicts"
            ? `Merging the latest ${integration.targetBranch} stopped on conflicts in: ${integration.conflicts.join(", ")}. ` +
              "Have the Coder resolve them, then commit again to complete the merge."
            : `${committed ? "Committed. " : "Nothing to commit. "}` +
              `${integration.status === "merged" ? `Merged the latest ${integration.targetBranch}.` : `Up to date with ${integration.targetBranch}.`}`;
        return updating(runtime, "commit", `${result}${changed ? " The QA checks are back to todo." : ""}`, {
          integration,
          plan,
          ...(changed ? { finished: false } : {}),
        });
      },
      {
        name: "commit",
        description:
          "Commit all changes with your message, then merge the latest default branch. Sets every QA check back to todo when the code changed.",
        schema: z.object({
          message: z
            .string()
            .optional()
            .describe("Commit message: a short summary line, then a blank line and the details. Needed when there are changes"),
        }),
      },
    ),
    tool(
      async ({ summary }, config) => {
        const runtime = runtimeOf(config);
        const problems = unfinishedPlan(runtime.state.plan, runtime.state.planApproved);
        if (!(await isUpToDate(issueId, need().refreshUpstream)))
          problems.push("The workspace isn't committed on top of the latest default branch: call commit, then review again.");
        else if ((await workspaceRevision(issueId)) !== runtime.state.reviewedRevision)
          problems.push("The code changed since the Reviewer's last review: review it again.");
        if (problems.length) throw new Error(`Can't finish yet:\n- ${problems.join("\n- ")}`);
        return updating(runtime, "finish", `Finished. Tell the user: ${summary}`, { finished: true });
      },
      {
        name: "finish",
        description:
          "Hand the work over. Refused unless every step is complete, every QA check passed or was skipped on the current code, " +
          "and everything is committed on top of the latest default branch.",
        schema: z.object({ summary: z.string().min(1).describe("What was done, for the user") }),
      },
    ),
  ];
}

// ---- The Lead ---------------------------------------------------------------------

// A run of the Lead can take many model calls; past this it stops and says so, and you
// can carry on with a message or Resume.
const MODEL_CALLS_PER_RUN = 150;

// Built per run, like the model, so a new setting applies straight away. Without a run,
// only for reading its state: its model is a stand-in that's never called.
function leadAgent(issueId: string, run: Run | null, model: BaseChatModel, systemPrompt: string, log?: RunLog) {
  const need = () => {
    if (!run) throw new Error("The Forge can't run without its setup");
    return run;
  };
  return createAgent({
    model,
    systemPrompt,
    // Only reading the Forge, without a run, goes through the cache.
    checkpointer: run ? checkpointer : readCheckpointer,
    tools: [
      ...leadTools(issueId, need),
      ...linearFileTools(() => need().setup.linear),
      diffTool(issueId),
      ...conflictTools(issueId),
      ...wikiTools,
      ...npmTools,
    ],
    middleware: [
      createMiddleware({
        name: "DrainForgeTools",
        wrapToolCall: (request, handler) =>
          run
            ? run.execution.track(async () => {
                run.signal?.throwIfAborted();
                return handler(request);
              })
            : handler(request),
      }),
      modelRetry,
      ...(log ? [logTo(log)] : []),
      ...(run ? [modelStamp(run.setup.model)] : []),
      toolErrors,
      compactionMiddleware(model),
      repairToolCalls,
      senderNames,
      leadState,
      oneAtATime,
      modelCallLimitMiddleware({ runLimit: MODEL_CALLS_PER_RUN, exitBehavior: "end" }),
      workspaceFilesystem(issueId),
      forgeSkillsMiddleware(issueId),
    ],
  });
}

const reader = (issueId: string) => leadAgent(issueId, null, fakeModel(), "");

async function readLead(issueId: string) {
  const snapshot = await reader(issueId).graph.getState(threadConfig(forgeThreadId(issueId)));
  const values = snapshot.values as Partial<LeadState> & { messages?: BaseMessage[] };
  const waiting = (snapshot.tasks.flatMap((task) => task.interrupts)[0]?.value ?? null) as ForgeWaiting | null;
  return { snapshot, values, waiting };
}

// Runs the Lead on input: a message, a reply to what it's waiting on, or null to carry on.
async function runLead(run: Run, input: unknown, describe: string, signal?: AbortSignal) {
  run.signal = signal;
  const { setup, issueId } = run;
  const prompt =
    `${LEAD_PROMPT}\n\n# The Linear issue\n\n${issueText(await fetchLinearIssue(setup.linear, issueId))}` +
    `\n\n# Workspace starting point\n\n${JSON.stringify(await workspaceContext(issueId))}`;
  const log = await openRunLog(issueId, "lead");
  await log.write({ event: "start", role: "lead", model: setup.model, prompt, input: describe });
  const before = (await readLead(issueId)).values;
  const wasFinished = Boolean(before.finished);
  const agent = leadAgent(issueId, run, forgeModel(setup), prompt, log);
  const source = agent.stream(input as never, streamConfig(forgeThreadId(issueId), 2_000, signal));
  return forgeEvents(
    Promise.resolve(logged(log, run.execution.stream(source))),
    async (): Promise<ForgeLifecycleEvent | null> => {
      const { values, waiting } = await readLead(issueId);
      if (values.finished && !wasFinished) return { type: "completed", plan: values.plan ?? null };
      if (waiting) return { type: "waiting", waiting };
      // A new revision of the plan, for the user to review.
      if (values.plan && !values.planApproved && values.plan.revision !== before.plan?.revision)
        return { type: "plan_ready", revision: values.plan.revision };
      return null;
    },
    (event) => emitForgeEvent(issueId, event),
    signal,
  );
}

async function* logged<T>(log: RunLog, source: AsyncIterable<T>) {
  try {
    yield* source;
    await log.write({ event: "end", outcome: "done", document: null });
  } catch (err) {
    await log.write({ event: "end", outcome: "error", error: String(err) });
    throw err;
  }
}

// Starts the issue's Forge, with an optional note for the Lead; the returned stream is
// the run (see startRun).
export function startForge(run: Run, note: string, signal?: AbortSignal) {
  const text = note ? `Start work on this issue. Note: ${note}` : "Start work on this issue.";
  return runLead(run, { messages: [userMessage(text, [], run.username ?? null)] }, text, signal);
}

// Sends the Lead a message, with any images (base64 data URLs), e.g. changes you want
// after it finished.
export function messageForge(run: Run, message: string, signal?: AbortSignal, images: string[] = []) {
  return runLead(run, { messages: [userMessage(message, images, run.username ?? null)] }, message, signal);
}

// Answers the Lead's questions, and carries on.
export function resumeForge(run: Run, reply: ForgeResume, signal?: AbortSignal) {
  return runLead(run, new Command({ resume: reply }), JSON.stringify(reply), signal);
}

// Why the plan's revision can't be approved now, or null if it can. Only the revision
// the user reviewed, and only while the Lead isn't working or asking.
export async function planApprovalError(issueId: string, revision: number) {
  const forge = await getForge(issueId);
  if (forge.running || forge.pausing) return "The Lead is working: approve the plan once it stops";
  if (forge.waiting) return "Answer the Lead's questions first";
  if (!forge.plan || forge.planApproved) return "There's no plan waiting for approval";
  if (forge.plan.revision !== revision) return `The plan has changed since: review revision ${forge.plan.revision}`;
  return null;
}

// Approves the plan's revision and tells the Lead, in one step, so it carries on.
export function approvePlan(run: Run, revision: number, signal?: AbortSignal) {
  const text = `I approved plan revision ${revision}.`;
  return runLead(run, { messages: [userMessage(text, [], run.username ?? null)], planApproved: true }, text, signal);
}

// Carries on paused or interrupted work, without adding input or bypassing a pause.
export function continueForge(run: Run, signal?: AbortSignal) {
  return runLead(run, null, "Continue", signal);
}

// Checks, and narrows, answers to the Lead's questions.
const replySchema: z.ZodType<ForgeResume> = z.strictObject({ answers: z.array(z.string()) });
export const readReply = (body: unknown) => replySchema.safeParse(body).data ?? null;

// Whether the answers fit the questions the Forge is waiting on.
export const replyFits = (waiting: ForgeWaiting | null, reply: ForgeResume) =>
  waiting?.kind === "questions" && reply.answers.length === waiting.questions.length;

// ---- Reading it -------------------------------------------------------------------

// The agent working now, if any: the Lead, or the worker it delegated to.
const runningAgent = (issueId: string): AgentRole | null =>
  runStatus(forgeThreadId(issueId)).running ? (working.get(issueId) ?? "lead") : null;

// The issue's Forge, for the webapp.
export async function getForge(issueId: string): Promise<ForgeState> {
  const threadId = forgeThreadId(issueId);
  const { snapshot, values, waiting: saved } = await readLead(issueId);
  const { running, error, pausing } = runStatus(threadId);
  // A running Forge isn't waiting on you: a tool that carries on after you answer keeps
  // the pause it resumed from until it finishes or pauses again.
  const waiting = running ? null : saved;
  return {
    started: Boolean(snapshot.createdAt),
    pausing: Boolean(pausing),
    canResume: Boolean(snapshot.createdAt && snapshot.next.length && !isRunning(threadId) && !waiting),
    running: runningAgent(issueId),
    waiting,
    plan: values.plan ?? null,
    planApproved: values.planApproved ?? false,
    integration: values.integration ?? null,
    browserUrl: browserUrl(issueId),
    finished: values.finished ?? false,
    error,
  };
}

// One agent's conversation, for the activity feed: the Lead's, or a worker's run for one
// of the Lead's delegate_coder or delegate_reviewer calls.
// Without tool results, which can be whole files: getToolResult reads one when it's opened.
export async function getForgeMessages(issueId: string, agent: AgentRole = "lead", delegation?: string) {
  const checkpoint = await readCheckpointer.getTuple(threadConfig(agentThreadId(issueId, agent, delegation)));
  return forgeMessages([{ agent, checkpoint }], runningAgent(issueId)).map((entry) =>
    entry.role === "tool" ? { ...entry, result: undefined } : entry,
  );
}

// The result of one tool call in that conversation, by the call's id; undefined if it has none.
export async function getToolResult(issueId: string, agent: AgentRole, delegation: string | undefined, callId: string) {
  const checkpoint = await readCheckpointer.getTuple(threadConfig(agentThreadId(issueId, agent, delegation)));
  const result =
    checkpoint &&
    checkpointMessages(checkpoint).find((message) => ToolMessage.isInstance(message) && message.tool_call_id === callId);
  return result?.text;
}

const agentThreadId = (issueId: string, agent: AgentRole, delegation?: string) =>
  agent === "lead" ? forgeThreadId(issueId) : workerThreadId(issueId, agent, delegation);

// Whether the Forge's plan is waiting for the user to approve it: it isn't approved, and
// the Lead has stopped working on it.
export const awaitingPlanApproval = (forge: ForgeState) =>
  Boolean(forge.plan && !forge.planApproved && !forge.running && !forge.pausing);

// The issues whose Forge has a plan waiting for approval, for marking them in the
// webapp's issue lists.
export async function pendingApprovals(): Promise<PendingApproval[]> {
  const workspaces = await Workspace.findAll({ attributes: ["issueId"] });
  const forges = await Promise.all(workspaces.map(async ({ issueId }) => ({ issueId, forge: await getForge(issueId) })));
  return forges.flatMap(({ issueId, forge }) =>
    awaitingPlanApproval(forge) ? [{ issueId, kind: "approve_plan" as const }] : [],
  );
}

// Stops what the workers started in the issue's workspace: their processes and browser.
export async function stopForgeProcesses(issueId: string) {
  await stopAllProcesses(issueId);
  await closeBrowser(issueId);
}

// Deletes the issue's Forge: the Lead's and its workers' conversations (every thread
// named after it), e.g. with its workspace.
export async function deleteConversation(issueId: string) {
  const thread = forgeThreadId(issueId);
  await loadForgeHistory(checkpointer, thread); // Creates the tables on a fresh database.
  const threads = checkpointer.db
    .prepare("SELECT DISTINCT thread_id FROM checkpoints WHERE thread_id = ? OR thread_id LIKE ?")
    .all(thread, `${thread}:%`) as { thread_id: string }[];
  for (const { thread_id } of threads) await checkpointer.deleteThread(thread_id);
}
