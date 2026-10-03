import type { LinearClient } from "@linear/sdk";
import { Command, START, StateGraph, interrupt, isGraphInterrupt } from "@langchain/langgraph";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, humanInTheLoopMiddleware, toolStrategy, type HITLRequest } from "langchain";
import type { AgentRole, Decision, PipelineResume, PipelineState, PipelineWaiting } from "shared";
import { z } from "zod";
import { checkpointer, modelRetry, streamConfig, threadConfig, toolErrors } from "./agents.js";
import { compactionMiddleware } from "./compaction.js";
import {
  IMPLEMENTATION_SCHEMA,
  PLAN_SCHEMA,
  QA_SCHEMA,
  REVIEW_SCHEMA,
} from "./coordinator/documents.js";
import { PipelineGraphState, type State } from "./coordinator/graphState.js";
import {
  answersText,
  clarificationsText,
  inputText,
  listText,
  planText,
} from "./coordinator/inputs.js";
import { logTo, openRunLog, type RunLog } from "./coordinator/runLog.js";
import {
  CODER_PROMPT,
  PLANNER_PROMPT,
  QA_PROMPT,
  REVIEWER_PROMPT,
} from "./coordinator/systemPrompts.js";
import { browserUrl, closeBrowser } from "./coordinator/qaBrowser.js";
import { stopAllProcesses } from "./coordinator/qaProcesses.js";
import { browserTools, COMMAND_TOOLS, commandTools } from "./coordinator/qaTools.js";
import { diffTool, readTools, writeTools } from "./coordinator/tools.js";
import { sendEvent } from "./events.js";
import { npmTools } from "./npmTools.js";
import { fetchLinearIssue, getLinearClient } from "./linear.js";
import { getKey } from "./models/Integration.js";
import { Workspace } from "./models/Workspace.js";
import { OPENROUTER_URL } from "./openrouter.js";
import { isRunning, runStatus } from "./runs.js";
import { getSetting } from "./settings.js";
import { readSetupLog } from "./workspaceSetup.js";

// The coordinator: a fixed pipeline per issue, run as a LangGraph graph in the issue's
// workspace. The planner plans (it can ask you questions), you approve the plan (or
// send feedback), then the coder and reviewer loop until the review requires no
// changes, and the QA runs the software to test them: a failure sends the coder back to
// work, then the reviewer and QA again. You can then send feedback on the changes,
// which runs the coder, reviewer and QA again. Each subagent is its own agent with its
// own tools, and returns a document (see coordinator/documents.ts). It pauses
// (interrupt) whenever it needs you.

export type Setup = {
  linear: LinearClient;
  openRouterKey: string;
  model: string;
};

// What the pipeline needs to run, or what's missing.
export async function loadSetup(): Promise<Setup | string> {
  const [linear, openRouterKey, model] = await Promise.all([
    getLinearClient(),
    getKey("openrouter"),
    getSetting("coordinatorModel"),
  ]);
  if (!linear) return "Linear isn't connected";
  if (!openRouterKey) return "OpenRouter isn't connected";
  if (!model) return "No coordinator model set";
  return { linear, openRouterKey, model };
}

// One pipeline per issue, so the issue id is enough to find it.
export const coordinatorThreadId = (issueId: string) =>
  `coordinator:${issueId}`;

// The coordinator's model, on OpenRouter: every subagent's, and the committer's.
export const coordinatorModel = (setup: Setup) =>
  new ChatOpenAI({
    model: setup.model,
    apiKey: setup.openRouterKey,
    configuration: { baseURL: OPENROUTER_URL },
  });

// A run paused for approval keeps its log here, so carrying on adds to the same one.
const pausedLogs = new Map<string, RunLog>();

// Runs a subagent to completion and returns its document, which the pipeline's state
// keeps. With remember, the subagent remembers its earlier runs: each run adds input to
// its messages, and long ones are compacted. Without, it starts fresh every time. Each
// run is logged (see runLog.ts). Calls to the tools in approve pause the pipeline for
// the user to approve or reject them (it needs remember, to carry on where it paused):
// the node runs again once they answer, and the run carries on from the pause.
async function runSubagent<S extends z.ZodObject>(
  { setup, issueId }: Run,
  {
    role,
    prompt,
    tools,
    schema,
    input,
    remember = false,
    approve = [],
  }: {
    role: AgentRole;
    prompt: string;
    tools: StructuredToolInterface[];
    schema: S;
    input: string;
    remember?: boolean;
    approve?: readonly string[];
  },
): Promise<z.infer<S>> {
  const logKey = `${issueId}:${role}`;
  let log = pausedLogs.get(logKey);
  pausedLogs.delete(logKey);
  if (!log) {
    log = await openRunLog(issueId, role);
    await log.write({ event: "start", role, model: setup.model, prompt, input });
  }
  const model = coordinatorModel(setup);
  const agent = createAgent({
    model,
    tools,
    systemPrompt: prompt,
    responseFormat: toolStrategy(schema),
    // modelRetry is outside logTo, so the log shows each failed attempt.
    middleware: [
      modelRetry,
      logTo(log),
      toolErrors,
      ...(remember ? [compactionMiddleware(model)] : []),
      ...(approve.length > 0
        ? [
            humanInTheLoopMiddleware({
              interruptOn: Object.fromEntries(
                approve.map((name) => [name, { allowedDecisions: ["approve", "reject"] }]),
              ),
            }),
          ]
        : []),
    ],
    // Run inside a pipeline node, the agent saves with the pipeline's checkpointer, on
    // its thread, under a namespace of the node's name and task id. The task id is new
    // every run; true leaves it out, so every run of the node (e.g. "coder") shares one
    // conversation.
    ...(remember ? { checkpointer: true } : {}),
  });
  try {
    // Plenty of steps: the coder may read and edit many files.
    const result = await agent.invoke(
      { messages: [{ role: "user", content: input }] },
      { recursionLimit: 300 },
    );
    const { structuredResponse } = result as {
      structuredResponse?: z.infer<S>;
    };
    if (!structuredResponse)
      throw new Error("The subagent finished without returning its document");
    await log.write({ event: "end", outcome: "done", document: structuredResponse });
    return structuredResponse;
  } catch (err) {
    if (isGraphInterrupt(err)) pausedLogs.set(logKey, log);
    else await log.write({ event: "end", outcome: "error", error: String(err) });
    throw err;
  }
}

// ---- The graph -------------------------------------------------------------------

// What running a node needs. Absent when the graph is only read (getPipeline).
type Run = { setup: Setup; issueId: string; notify: () => void };

// A run of the issue's pipeline, which tells every connected webapp whenever it changes.
export const pipelineRun = (setup: Setup, issueId: string): Run => ({
  setup,
  issueId,
  notify: () => sendEvent({ type: "coordinator.updated", issueId }),
});

function buildPipeline(run: Run | null) {
  const need = () => {
    if (!run) throw new Error("The pipeline can't run without its setup");
    return run;
  };
  const issue = () => fetchLinearIssue(need().setup.linear, need().issueId);

  // The planner and coder remember their earlier runs (see runSubagent). Their system
  // prompt has the whole context, rebuilt from the state every run, so it's always
  // current and survives compaction; their input says only why they run again.

  async function planner(state: State) {
    const { issueId } = need();
    const { plan: previous } = state;
    const plan = await runSubagent(need(), {
      role: "planner",
      prompt: `${PLANNER_PROMPT}\n\n${inputText(await issue(), [
        ["Note from the user", state.note],
        ["Your previous plan", previous && planText(previous)],
        ["The user's answers", clarificationsText(state.clarifications)],
        [
          "The user's feedback on your plan (address it)",
          state.planFeedback.length > 0 && listText(state.planFeedback),
        ],
      ])}`,
      tools: [...readTools(issueId), ...npmTools],
      schema: PLAN_SCHEMA,
      // Runs after its questions are answered, or after feedback on its plan.
      input: !previous
        ? "Write the plan."
        : hasQuestions(previous)
          ? `The user answered your questions:\n\n${answersText(state.clarifications, previous)}`
          : `The user's feedback on your plan:\n\n${state.planFeedback.at(-1)}`,
      remember: true,
    });
    return { plan, planApproved: false };
  }

  async function coder(state: State) {
    const { issueId, notify } = need();
    const { implementation: previous } = state;
    const changes = state.review?.requiredChanges ?? [];
    const implementation = await runSubagent(need(), {
      role: "coder",
      prompt: `${CODER_PROMPT}\n\n${inputText(await issue(), [
        ["The approved plan", state.plan && planText(state.plan)],
        ["The user's answers", clarificationsText(state.clarifications)],
        [
          "The user's feedback on the changes (apply it)",
          state.implementationFeedback.length > 0 &&
            listText(state.implementationFeedback),
        ],
      ])}`,
      tools: [
        ...readTools(issueId),
        ...writeTools(issueId, notify),
        diffTool(issueId),
        ...npmTools,
      ],
      schema: IMPLEMENTATION_SCHEMA,
      // Runs after its questions are answered, after a review that requires changes,
      // or after feedback on the finished changes.
      input: !previous
        ? "Implement the approved plan."
        : hasQuestions(previous)
          ? `The user answered your questions:\n\n${answersText(state.clarifications, previous)}`
          : changes.length > 0
            ? `The review asks for these changes:\n\n${listText(changes)}`
            : state.qaReport?.verdict === "fail"
              ? `The QA found these failures:\n\n${listText(state.qaReport.failures)}`
              : `The user's feedback on your changes:\n\n${state.implementationFeedback.at(-1)}`,
      remember: true,
    });
    return { implementation };
  }

  async function reviewer(state: State) {
    const { issueId } = need();
    const review = await runSubagent(need(), {
      role: "reviewer",
      prompt: REVIEWER_PROMPT,
      tools: [...readTools(issueId), diffTool(issueId), ...npmTools],
      schema: REVIEW_SCHEMA,
      input: inputText(await issue(), [
        ["The approved plan", state.plan && planText(state.plan)],
        ["The user's answers", clarificationsText(state.clarifications)],
        [
          "The user's feedback on the changes (they must be applied too)",
          state.implementationFeedback.length > 0 &&
            listText(state.implementationFeedback),
        ],
        [
          "What the QA found broken (the coder must fix it too)",
          state.qaReport?.verdict === "fail" && listText(state.qaReport.failures),
        ],
      ]),
    });
    return { review };
  }

  // The QA runs the software to test the changes. Each command it runs waits for your
  // approval (the pipeline pauses on them). What it started (processes, its browser) is
  // stopped when it's done, but not while it waits on you.
  async function qa(state: State) {
    const { issueId, notify } = need();
    const { qaReport: previous } = state;
    let paused = false;
    try {
      const report = await runSubagent(need(), {
        role: "qa",
        prompt: `${QA_PROMPT}\n\n${inputText(await issue(), [
          ["The approved plan", state.plan && planText(state.plan)],
          ["The user's answers", clarificationsText(state.clarifications)],
          [
            "The user's feedback on the changes",
            state.implementationFeedback.length > 0 &&
              listText(state.implementationFeedback),
          ],
          ["The workspace's setup", await setupText(issueId)],
        ])}`,
        tools: [
          ...readTools(issueId),
          diffTool(issueId),
          // No npm tools: it tests behaviour, and doesn't read libraries' code.
          ...commandTools(issueId),
          ...browserTools(issueId, notify),
        ],
        schema: QA_SCHEMA,
        // Runs after its questions are answered, or after the code changed since its
        // last report (a fix, or your feedback).
        input: !previous
          ? "Test the changes."
          : hasQuestions(previous)
            ? `The user answered your questions:\n\n${answersText(state.clarifications, previous)}`
            : "The code has changed since your last report: test the changes again.",
        remember: true,
        approve: COMMAND_TOOLS,
      });
      return { qaReport: report };
    } catch (err) {
      paused = isGraphInterrupt(err);
      throw err;
    } finally {
      if (!paused) {
        await stopQa(issueId);
        notify();
      }
    }
  }

  // Pauses on a subagent's questions; your answers are kept, and it runs again.
  const ask = (
    from: AgentRole,
    document: (state: State) => { blockingQuestions: string[] } | null,
  ) =>
    function ask(state: State) {
      const questions = document(state)?.blockingQuestions ?? [];
      const { answers } = interrupt<PipelineWaiting, { answers: string[] }>({
        kind: "questions",
        from,
        questions,
      });
      return {
        clarifications: questions.map((question, i) => ({
          from,
          question,
          answer: answers[i] ?? "",
        })),
      };
    };

  // Pauses for you to approve the plan, or send feedback on it.
  function approvePlan() {
    const reply = interrupt<
      PipelineWaiting,
      { approve: true } | { feedback: string }
    >({ kind: "approve_plan" });
    return "approve" in reply
      ? { planApproved: true }
      : { planFeedback: [reply.feedback] };
  }

  // Done: waits for feedback on the changes, which runs the coder again.
  function finish() {
    return { finished: true };
  }
  function awaitFeedback() {
    const { feedback } = interrupt<PipelineWaiting, { feedback: string }>({
      kind: "feedback",
    });
    return { finished: false, implementationFeedback: [feedback] };
  }

  const hasQuestions = (doc: { blockingQuestions: string[] } | null) =>
    (doc?.blockingQuestions.length ?? 0) > 0;

  return new StateGraph(PipelineGraphState)
    .addNode("planner", planner)
    .addNode(
      "ask_planner",
      ask("planner", (s) => s.plan),
    )
    .addNode("approve_plan", approvePlan)
    .addNode("coder", coder)
    .addNode(
      "ask_coder",
      ask("coder", (s) => s.implementation),
    )
    .addNode("reviewer", reviewer)
    .addNode(
      "ask_reviewer",
      ask("reviewer", (s) => s.review),
    )
    .addNode("qa", qa)
    .addNode(
      "ask_qa",
      ask("qa", (s) => s.qaReport),
    )
    .addNode("finish", finish)
    .addNode("await_feedback", awaitFeedback)
    .addEdge(START, "planner")
    .addConditionalEdges("planner", (s) =>
      hasQuestions(s.plan) ? "ask_planner" : "approve_plan",
    )
    .addEdge("ask_planner", "planner")
    .addConditionalEdges("approve_plan", (s) =>
      s.planApproved ? "coder" : "planner",
    )
    .addConditionalEdges("coder", (s) =>
      hasQuestions(s.implementation) ? "ask_coder" : "reviewer",
    )
    .addEdge("ask_coder", "coder")
    .addConditionalEdges("reviewer", (s) => {
      if (hasQuestions(s.review)) return "ask_reviewer";
      return (s.review?.requiredChanges.length ?? 0) > 0 ? "coder" : "qa";
    })
    .addEdge("ask_reviewer", "reviewer")
    .addConditionalEdges("qa", (s) => {
      if (hasQuestions(s.qaReport)) return "ask_qa";
      return s.qaReport?.verdict === "fail" ? "coder" : "finish";
    })
    .addEdge("ask_qa", "qa")
    .addEdge("finish", "await_feedback")
    .addEdge("await_feedback", "coder")
    .compile({ checkpointer });
}

// ---- Running and reading it -------------------------------------------------------

// The pipeline's own graph keeps LangGraph's default step limit (25) on purpose: its
// steps are whole nodes, so it never comes close, and a coder↔reviewer (or coder →
// reviewer → QA) loop costs real money every time round, which 25 stops early.

// Starts the issue's pipeline with an optional note for the planner; the returned
// stream is the run (see startRun).
export function startPipeline(run: Run, note: string) {
  return buildPipeline(run).stream(
    { note },
    streamConfig(coordinatorThreadId(run.issueId)),
  );
}

// Runs start outside whatever LangGraph run calls it, e.g. a product manager tool's.
// Inside one, the pipeline would join it as a subgraph, saving its checkpoints under
// that run's namespace (where getPipeline doesn't look) and sharing its callbacks.
export const outsideAgentRun = <T>(start: () => T) =>
  AsyncLocalStorageProviderSingleton.getInstance().run(undefined, start);

// Checks, and narrows, a reply to what the pipeline is waiting on.
export function readReply(body: unknown): PipelineResume | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.answers) && b.answers.every((a) => typeof a === "string")) {
    return { answers: b.answers as string[] };
  }
  if (b.approve === true) return { approve: true };
  if (typeof b.feedback === "string" && b.feedback.trim()) return { feedback: b.feedback.trim() };
  if (Array.isArray(b.decisions) && b.decisions.every(isDecision)) {
    return { decisions: b.decisions as Decision[] };
  }
  return null;
}

const isDecision = (d: unknown): d is Decision =>
  typeof d === "object" &&
  d !== null &&
  ((d as Decision).type === "approve" ||
    ((d as Decision).type === "reject" &&
      ["string", "undefined"].includes(typeof (d as { message?: unknown }).message)));

// Whether a reply answers what the pipeline is waiting on.
export function replyFits(waiting: PipelineWaiting | null, reply: PipelineResume) {
  return (
    (waiting?.kind === "questions" && "answers" in reply && reply.answers.length === waiting.questions.length) ||
    (waiting?.kind === "approve_plan" && ("approve" in reply || "feedback" in reply)) ||
    (waiting?.kind === "approve_commands" &&
      "decisions" in reply &&
      reply.decisions.length === waiting.commands.length) ||
    (waiting?.kind === "feedback" && "feedback" in reply)
  );
}

// Answers what the pipeline is waiting on, and carries on.
export function resumePipeline(run: Run, reply: PipelineResume) {
  return buildPipeline(run).stream(
    new Command({ resume: reply }),
    streamConfig(coordinatorThreadId(run.issueId)),
  );
}

const ROLE_NODES: Record<string, AgentRole> = {
  planner: "planner",
  coder: "coder",
  reviewer: "reviewer",
  qa: "qa",
};

// What the pipeline is paused on: one of its own pauses, or the QA's commands waiting
// for approval (its humanInTheLoopMiddleware's request).
function toWaiting(value: unknown): PipelineWaiting | null {
  if (!value) return null;
  if (typeof value === "object" && "actionRequests" in value) {
    return {
      kind: "approve_commands",
      commands: (value as HITLRequest).actionRequests.map(({ name, args }) => ({
        tool: name,
        command: String(args.command ?? ""),
      })),
    };
  }
  return value as PipelineWaiting;
}

// Stops what the QA started in the issue's workspace: its processes and its browser.
export async function stopQa(issueId: string) {
  stopAllProcesses(issueId);
  await closeBrowser(issueId);
}

// The workspace's setup, for the QA: the command, how it went, and the end of its log.
async function setupText(issueId: string) {
  const [workspace, command, log] = await Promise.all([
    Workspace.findByPk(issueId),
    getSetting("workspaceSetupCommand"),
    readSetupLog(issueId),
  ]);
  if (!command) return "No setup command is set: nothing ran when the workspace was made.";
  const status = workspace?.setupError
    ? `${workspace.setupStatus}: ${workspace.setupError}`
    : (workspace?.setupStatus ?? "unknown");
  const end = log.slice(-3_000).trim();
  return `Command: ${command}\nStatus: ${status}${end ? `\n\nThe end of its output:\n\n${end}` : ""}`;
}

// The issue's pipeline, for the webapp.
export async function getPipeline(issueId: string): Promise<PipelineState> {
  const threadId = coordinatorThreadId(issueId);
  const snapshot = await buildPipeline(null).getState(threadConfig(threadId));
  const values = snapshot.values as Partial<State>;
  const running = isRunning(threadId);
  // A running pipeline isn't waiting on you. Its saved state can still say it is: a
  // node that carries on after you answer (the QA, after you approve its commands)
  // keeps the pause it resumed from until it finishes or pauses again.
  const waiting = running
    ? null
    : toWaiting(snapshot.tasks.flatMap((task) => task.interrupts)[0]?.value);
  const { error } = runStatus(threadId);
  return {
    started: Boolean(snapshot.createdAt),
    // While a run goes on, its next node is the one working.
    running: running ? (ROLE_NODES[snapshot.next[0] ?? ""] ?? null) : null,
    waiting,
    plan: values.plan ?? null,
    planApproved: values.planApproved ?? false,
    implementation: values.implementation ?? null,
    review: values.review ?? null,
    qa: values.qaReport ?? null,
    clarifications: values.clarifications ?? [],
    browserUrl: browserUrl(issueId),
    finished: values.finished ?? false,
    error,
  };
}

// What the committer is told about the pipeline: the approved plan, and your answers
// and feedback, which explain the changes.
export async function commitContext(issueId: string) {
  const snapshot = await buildPipeline(null).getState(threadConfig(coordinatorThreadId(issueId)));
  const values = snapshot.values as Partial<State>;
  return {
    plan: values.planApproved ? (values.plan ?? null) : null,
    clarifications: values.clarifications ?? [],
    planFeedback: values.planFeedback ?? [],
    implementationFeedback: values.implementationFeedback ?? [],
  };
}

// Deletes the issue's pipeline, with its planner's and coder's conversations (saved on
// its thread), e.g. with its workspace.
export async function deleteConversation(issueId: string) {
  await checkpointer.deleteThread(coordinatorThreadId(issueId));
}
