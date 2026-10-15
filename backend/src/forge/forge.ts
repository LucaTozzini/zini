import type { LinearClient } from "@linear/sdk";
import { Command, END, START, StateGraph, interrupt, isGraphInterrupt } from "@langchain/langgraph";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createAgent, toolStrategy } from "langchain";
import type {
  AgentRole,
  LinearIssueDetails,
  PendingApproval,
  PipelineResume,
  PipelineRedirect,
  PipelineState,
  PipelineWaiting,
} from "shared";
import { z } from "zod";
import { createMiddleware } from "langchain";
import type { BaseMessage } from "@langchain/core/messages";
import { checkpointer, modelRetry, streamConfig, threadConfig, toolErrors } from "../agents/agents.js";
import { compactionMiddleware } from "../agents/compaction.js";
import { wikiTools } from "../openwiki/wikiTools.js";
import {
  IMPLEMENTATION_SCHEMA,
  PLAN_SCHEMA,
  QA_SCHEMA,
  REVIEW_SCHEMA,
} from "./documents.js";
import { requireSubmission } from "./submission.js";
import { PipelineExecution } from "./execution.js";
import { emitForgeEvent, type ForgeLifecycleEvent } from "./events.js";
import { pipelineEvents } from "./pipelineEvents.js";
import { ReviewEvidence, reviewerTools } from "./reviewerTools.js";
import { SetupEvidence, setupTools } from "./setupTools.js";
import { developmentEnvironmentContext } from "../core/developmentEnvironment.js";
import { workspaceServiceHealth } from "../workspaces/workspaceServices.js";
import { checkpointMessages, humanMessage, replyMessage, timelineEvents } from "./messages.js";
import { loadForgeHistory } from "./history.js";
import { checksText, enforceCoverage, freshRunbook, runbookText, updateRunbook } from "./validation.js";
import { redirectUpdate, steeringOptions } from "./steering.js";
import { workspaceApps } from "../workspaces/workspaceAppSessions.js";
import { PipelineGraphState, type State } from "./graphState.js";
import {
  answersText,
  clarificationsText,
  inputText,
  listText,
  planText,
} from "./inputs.js";
import { logTo, openRunLog, type RunLog } from "./runLog.js";
import {
  CODER_PROMPT,
  PLANNER_PROMPT,
  QA_PROMPT,
  REVIEWER_PROMPT,
} from "./systemPrompts.js";
import { browserUrl, closeBrowser } from "../browser/agentBrowser.js";
import { drainProcesses, stopAllProcesses } from "./qaProcesses.js";
import { browserTools, commandTools } from "./qaTools.js";
import { conflictTools, diffTool, workspaceFilesystem, writeTools } from "./tools.js";
import { prepareIntegration, commitCoderRound, workspaceContext, assertNoMerge } from "../workspaces/workspaceIntegration.js";
import { sendEvent } from "../core/events.js";
import { npmTools } from "../agents/npmTools.js";
import { fetchLinearIssue, getLinearClient } from "../integrations/linear.js";
import { Workspace } from "../models/Workspace.js";
import { chatModel, loadConnection, type ModelConnection } from "../providers/modelProvider.js";
import { isRunning, isRedirecting, runStatus, startRun, withPausedRun } from "../agents/runs.js";
import { getSetting } from "../core/settings.js";
import { fingerprintWorkspaceFile, workspaceRevision, hasUncommitted } from "../workspaces/workspaceFiles.js";

// The forge: a fixed pipeline per issue, run as a LangGraph graph in the issue's
// workspace. The planner plans (it can ask you questions), you approve the plan (or
// send feedback), then coder → reviewer (environment preparation, checks and code review) → product QA. A
// review or QA failure sends the coder back to work within the graph step limit.
// User feedback runs the same validation sequence again. Each subagent has its
// own tools, and returns a document (see forge/documents.ts). It pauses
// (interrupt) whenever it needs you.

export type Setup = {
  linear: LinearClient;
  connection: ModelConnection;
  model: string;
};

// What the pipeline needs to run, or what's missing.
export async function loadSetup(): Promise<Setup | string> {
  const [linear, provider, model] = await Promise.all([
    getLinearClient(),
    getSetting("forgeProvider"),
    getSetting("forgeModel"),
  ]);
  if (!linear) return "Linear isn't connected";
  const connection = await loadConnection(provider);
  if (typeof connection === "string") return connection;
  if (!model) return "No Forge model set";
  return { linear, connection, model };
}

// One pipeline per issue, so the issue id is enough to find it.
export const forgeThreadId = (issueId: string) =>
  `forge:${issueId}`;

// The Forge model is shared by its subagents.
// Our middleware owns retries, and must stop immediately on model rate limits.
export const forgeModel = (setup: Setup) => chatModel(setup.connection, setup.model, { maxRetries: 0 });

// A run paused for approval keeps its log here, so carrying on adds to the same one.
const pausedLogs = new Map<string, RunLog>();

// Runs a subagent to completion and returns its document, which the pipeline's state
// keeps. With remember, the subagent remembers its earlier runs: each run adds input to
// its messages, and long ones are compacted. Without, it starts fresh every time. Each
// run is logged (see runLog.ts). Repository commands execute in the Docker sandbox
// without tool approvals. The pipeline owns plan approval and clarification pauses.
export type Subagent<S extends z.ZodObject> = {
  role: AgentRole;
  prompt: string;
  tools: StructuredToolInterface[];
  schema: S;
  input: string;
  remember?: boolean;
  // Messages before the input: an earlier conversation an agent eval starts from.
  history?: BaseMessage[];
  // What's wrong with a submitted document, or nothing if it's valid.
  validate?: (document: z.infer<S>) => string | undefined | Promise<string | undefined>;
};

export async function runSubagent<S extends z.ZodObject>(
  { setup, issueId, notify, signal, execution }: Run,
  { role, prompt, tools, schema, input, remember = false, history = [], validate }: Subagent<S>,
): Promise<z.infer<S>> {
  const logKey = `${issueId}:${role}`;
  let log = pausedLogs.get(logKey);
  pausedLogs.delete(logKey);
  if (!log) {
    log = await openRunLog(issueId, role);
    await log.write({ event: "start", role, model: setup.model, prompt, input });
  }
  const model = forgeModel(setup);
  const agent = createAgent({
    model,
    tools,
    systemPrompt: prompt,
    responseFormat: toolStrategy(schema),
    // modelRetry is outside logTo, so the log shows each failed attempt.
    middleware: [
      createMiddleware({
        name: "DrainPipelineTools",
        wrapToolCall: (request, handler) => execution.track(async () => {
          signal?.throwIfAborted();
          return handler(request);
        }),
      }),
      modelRetry,
      logTo(log),
      toolErrors,
      workspaceFilesystem(issueId, role === "coder", notify),
      requireSubmission(String(schema.meta()?.title), (attempt) => log.write({ event: "doc_recovery", attempt })),
      ...(remember ? [compactionMiddleware(model)] : []),
    ],
    // Run inside a pipeline node, the agent saves with the pipeline's checkpointer, on
    // its thread, under a namespace of the node's name and task id. The task id is new
    // every run; true leaves it out, so every run of the node (e.g. "coder") shares one
    // conversation.
    ...(remember ? { checkpointer: true } : {}),
  });
  // Runs the agent from these messages to its document.
  const respond = async (messages: (BaseMessage | { role: "user"; content: string })[]) => {
    // Plenty of steps: the coder may read and edit many files.
    let result: { messages?: BaseMessage[]; structuredResponse?: z.infer<S> } = {};
    const stream = await agent.stream(
      { messages },
      {
        recursionLimit: 300, signal, streamMode: "values", durability: "sync",
        // A remembered agent gets a NEW turn, even when the parent is
        // continuing after a pause/redirect. Otherwise the inherited resume flag
        // skips this input and resumes its already-completed child checkpoint.
        ...(remember ? { configurable: { __pregel_resuming: false } } : {}),
      },
    );
    for await (const state of stream) {
      result = state as unknown as typeof result;
      notify();
    }
    signal?.throwIfAborted();
    // requireSubmission keeps the agent going until it submits, or fails the run.
    if (!result.structuredResponse) throw new Error(`The ${role} ended without its document`);
    return { messages: result.messages ?? [], document: result.structuredResponse };
  };
  try {
    let { messages, document } = await respond([...history, { role: "user", content: input }]);
    // A document that breaks a rule its schema can't express goes back to the agent
    // with the error, on top of its conversation (its memory only lasts one call).
    for (let attempt = 1, error = await validate?.(document); error; attempt++, error = await validate?.(document)) {
      await log.write({ event: "doc_invalid", error });
      if (attempt > 2) throw new Error(`The ${role} submitted an invalid document three times: ${error}`);
      ({ messages, document } = await respond([...messages,
        { role: "user", content: `Your document was invalid: ${error}. Submit it again.` }]));
    }
    await log.write({ event: "end", outcome: "done", document });
    return document;
  } catch (err) {
    if (isGraphInterrupt(err)) pausedLogs.set(logKey, log);
    else await log.write({ event: "end", outcome: "error", error: String(err) });
    throw err;
  }
}

// The reviewer for the issue's state: its agent, and what its document adds to the
// state. Shared by the pipeline and agent evals (evals/agents).
export async function reviewerAgent(issueId: string, issue: LinearIssueDetails, state: State) {
  const fingerprint = (path: string) => fingerprintWorkspaceFile(issueId, path);
  const book = await freshRunbook(state.runbook ?? {}, fingerprint);
  const revision = await workspaceRevision(issueId);
  const evidence = new ReviewEvidence(state.checksReport, revision);
  const preparation = new SetupEvidence(state.environmentReport, revision, () => { evidence.results = []; });
  // QA failed on the code this reviewer approved: a commit would have cleared the review.
  // Approving it again would only send the same code back to QA.
  const qaFailedApproved = state.qaReport?.verdict === "fail" && Boolean(state.review) &&
    !state.review!.requiredChanges.length && !state.review!.blockingQuestions.length;
  const agent: Subagent<typeof REVIEW_SCHEMA> = {
    role: "reviewer",
    tools: [diffTool(issueId), ...npmTools, ...setupTools(issueId, preparation), ...reviewerTools(issueId, evidence), ...wikiTools],
    schema: REVIEW_SCHEMA,
    prompt: `${REVIEWER_PROMPT}

${inputText(issue, [
      ["Workspace starting point", JSON.stringify(await workspaceContext(issueId))],
      ["Upstream integration", JSON.stringify(state.integration)],
      ["The approved plan", state.plan && planText(state.plan)],
      ["The user's answers", clarificationsText(state.clarifications)],
      ["Forge steering feedback (oldest first)", listText(state.steeringFeedback ?? [])],
      ["Repo runbook", runbookText(book, state.checksReport)],
      ["Recorded deterministic checks", checksText(state.checksReport)],
      ["Previous environment preparation", state.environmentReport && JSON.stringify(state.environmentReport)],
      ["Configured development variable names (values are private)", await developmentEnvironmentContext()],
      [
        "The user's feedback on the changes (they must be applied too)",
        state.implementationFeedback.length > 0 &&
          listText(state.implementationFeedback),
      ],
      [
        "Previous QA report (historical findings to reassess against the current implementation)",
        state.qaReport && JSON.stringify(state.qaReport),
      ],
    ])}`,
    input: qaFailedApproved
      ? "QA failed on the code you approved, which hasn't changed since. Diagnose each failure in the previous QA report: request a concrete source repair, or, if you can't trace a failure to the source (e.g. behavior that varies between runs), ask the user in blockingQuestions."
      : "Prepare the required environment, review the full implementation against the issue and plan, and execute and diagnose relevant checks.",
    remember: true,
    validate: async review => {
      const invalid = evidence.validate(review);
      if (invalid) return invalid;
      if (qaFailedApproved && !review.requiredChanges.length && !review.blockingQuestions.length)
        return "QA failed on this exact code, so it can't be approved again unchanged. Request a concrete source repair for each QA failure, or ask the user in blockingQuestions about failures you can't trace to the source";
      if (!review.requiredChanges.length && !review.blockingQuestions.length) {
        try { await workspaceServiceHealth(issueId); }
        catch (error) { return `Required workspace service is not healthy: ${String(error)}. Repair it or submit blockingQuestions.`; }
      }
      if (await workspaceRevision(issueId) !== revision) return "Validation changed tracked source. Restore it; report necessary source changes to coder instead of editing implementation.";
    },
  };
  const finish = async (document: z.infer<typeof REVIEW_SCHEMA>) => {
    const { runbookUpdates, noChecksReason, preexistingFailures, ...review } = document;
    return { review, checksReport: evidence.report(noChecksReason, preexistingFailures),
      environmentReport: preparation.report(review),
      runbook: await updateRunbook(book, runbookUpdates, fingerprint) };
  };
  return { agent, finish };
}

// ---- The graph -------------------------------------------------------------------

// What running a node needs. Absent when the graph is only read (getPipeline).
export type Run = { setup: Setup; issueId: string; notify: () => void; signal?: AbortSignal; execution: PipelineExecution; username?: string; refreshUpstream?: () => Promise<void> };

// A run of the issue's pipeline, which tells every connected webapp whenever it changes.
export const pipelineRun = (setup: Setup, issueId: string, username?: string, refreshUpstream?: () => Promise<void>): Run => ({
  setup,
  issueId,
  username,
  refreshUpstream,
  execution: new PipelineExecution(),
  notify: () => sendEvent({ type: "forge.updated", issueId }),
});

function buildPipeline(run: Run | null) {
  const need = () => {
    if (!run) throw new Error("The pipeline can't run without its setup");
    return run;
  };
  const issue = () => fetchLinearIssue(need().setup.linear, need().issueId);
  const fingerprint = (path: string) => fingerprintWorkspaceFile(need().issueId, path);
  const runbook = (state: State) => freshRunbook(state.runbook ?? {}, fingerprint);

  // Every pipeline agent gets current issue/state context in its system prompt,
  // rebuilt each run. The user message says what to do. Planner and coder retain
  // their conversations; refreshing their context also keeps it through compaction.

  async function planner(state: State) {
    const { plan: previous } = state;
    const plan = await runSubagent(need(), {
      role: "planner",
      prompt: `${PLANNER_PROMPT}\n\n${inputText(await issue(), [
        ["Workspace starting point", JSON.stringify(await workspaceContext(need().issueId))],
        ["Upstream integration", JSON.stringify(state.integration)],
        ["Note from the user", state.note],
        ["Your previous plan", previous && planText(previous)],
        ["Coder request to revise the plan", state.implementation?.replanReason],
        ["The user's answers", clarificationsText(state.clarifications)],
        ["Forge steering feedback (oldest first)", listText(state.steeringFeedback ?? [])],
        [
          "The user's feedback on your plan (address it)",
          state.planFeedback.length > 0 && listText(state.planFeedback),
        ],
      ])}`,
      tools: [diffTool(need().issueId), ...conflictTools(need().issueId), ...npmTools, ...wikiTools],
      schema: PLAN_SCHEMA,
      // Runs after its questions are answered, or after feedback on its plan.
      input: !previous
        ? "Write the plan."
        : hasQuestions(previous)
          ? `The user answered your questions:\n\n${answersText(state.clarifications, previous)}`
          : state.implementation?.replanReason
            ? `Reassess the approved approach: ${state.implementation.replanReason}`
            : state.integration?.status === "merged" || state.integration?.status === "conflicts"
              ? "Reassess inherited implementation and upstream changes. Preserve full acceptance criteria and plan only remaining work and conflict resolution."
              : `The user's feedback on your plan:\n\n${state.planFeedback.at(-1) ?? "Reassess the current implementation."}`,
      remember: true,
    });
    if (new Set(plan.acceptanceCriteria.map((entry) => entry.id)).size !== plan.acceptanceCriteria.length)
      throw new Error("Acceptance criterion ids must be unique");
    return { plan, planApproved: false, checksReport: null };
  }

  async function coder(state: State) {
    const { issueId, notify } = need();
    const { implementation: previous } = state;
    const changes = state.review?.requiredChanges ?? [];
    const book = await runbook(state);
    const implementation = await runSubagent(need(), {
      role: "coder",
      prompt: `${CODER_PROMPT}\n\n${inputText(await issue(), [
        ["Workspace starting point", JSON.stringify(await workspaceContext(need().issueId))],
        ["Upstream integration", JSON.stringify(state.integration)],
        ["The approved plan", state.plan && planText(state.plan)],
        ["Current Reviewer requested changes", listText(changes) || "No Reviewer changes currently requested."],
        ["The user's answers", clarificationsText(state.clarifications)],
        ["Forge steering feedback (oldest first)", listText(state.steeringFeedback ?? [])],
        ["Repo runbook", runbookText(book, state.checksReport)],
        ["Recorded checks and diagnostics", checksText(state.checksReport)],
        [
          "The user's feedback on the changes (apply it)",
          state.implementationFeedback.length > 0 &&
            listText(state.implementationFeedback),
        ],
      ])}`,
      tools: [
        ...writeTools(issueId, notify),
        diffTool(issueId),
        ...conflictTools(issueId, true),
        ...npmTools,
        ...wikiTools,
      ],
      schema: IMPLEMENTATION_SCHEMA,
      // Runs after its questions are answered, after a review that requires changes,
      // or after feedback on the finished changes.
      input: changes.length > 0
        ? `Implement the Reviewer's requested changes:\n\n${listText(changes)}`
        : !previous
        ? "Implement the approved plan."
        : hasQuestions(previous)
          ? `The user answered your questions:\n\n${answersText(state.clarifications, previous)}`
          : state.implementationFeedback.length
                ? `The user's feedback on your changes:\n\n${state.implementationFeedback.at(-1)}`
                : "Implement the current approved plan, including pending conflicts; preserve existing work.",
      remember: true,
      // A repair that changes nothing would only send the same code back to review.
      validate: async (submitted) => changes.length > 0 && !submitted.blockingQuestions.length &&
        !submitted.replanReason && !(await hasUncommitted(issueId))
        ? "The Reviewer requested changes, but you changed nothing. Make the requested changes, or explain in blockingQuestions why they can't be made"
        : undefined,
    });
    return { implementation };
  }

  async function reviewer(state: State) {
    const { issueId } = need();
    const { agent, finish } = await reviewerAgent(issueId, await issue(), state);
    let document;
    try { document = await runSubagent(need(), agent); }
    finally { await stopAllProcesses(issueId); }
    return finish(document);
  }

  // QA runs commands automatically in Docker. Its processes and browser are stopped
  // when it finishes, and retained only while a checkpoint is interrupted.
  async function qa(state: State) {
    const { issueId, notify } = need();
    const { qaReport: previous } = state;
    const book = await runbook(state);
    if (!state.plan) throw new Error("QA requires the approved plan");
    const criteria = state.plan.acceptanceCriteria;
    let paused = false;
    try {
      const { runbookUpdates, ...report } = await runSubagent(need(), {
        role: "qa",
        prompt: `${QA_PROMPT}\n\n${inputText(await issue(), [
        ["Workspace starting point", JSON.stringify(await workspaceContext(need().issueId))],
        ["Upstream integration", JSON.stringify(state.integration)],
          ["The approved plan", state.plan && planText(state.plan)],
          ["The user's answers", clarificationsText(state.clarifications)],
        ["Forge steering feedback (oldest first)", listText(state.steeringFeedback ?? [])],
          ["Repo runbook", runbookText(book, state.checksReport)],
          ["Recorded deterministic checks (do not repeat)", checksText(state.checksReport)],
          ["Completed environment preparation", state.environmentReport && JSON.stringify(state.environmentReport)],
          ["Acceptance criteria", JSON.stringify(criteria)],
          ["Previous QA report (historical evidence; retest exact failed or blocked examples first)", previous && JSON.stringify(previous)],
          [
            "The user's feedback on the changes",
            state.implementationFeedback.length > 0 &&
              listText(state.implementationFeedback),
          ],
        ])}`,
        tools: [
          diffTool(issueId),
          // No npm tools: it tests behaviour, and doesn't read libraries' code.
          ...commandTools(issueId, { productOnly: true, completedChecks: state.checksReport?.results.map((entry) => entry.command) ?? [] }),
          ...browserTools(issueId, notify),
        ],
        schema: QA_SCHEMA,
        // Runs after its questions are answered, or after the code changed since its
        // last report (a fix, or your feedback).
        input: !previous
          ? "Test the changes."
          : hasQuestions(previous)
            ? `The user answered your questions:\n\n${answersText(state.clarifications, previous)}`
            : "Retest the previous report's exact failed or blocked examples first, then verify affected acceptance criteria with fresh evidence.",
        remember: true,
      });
      return { qaReport: enforceCoverage(report, criteria, state.checksReport, await workspaceRevision(issueId)),
        runbook: await updateRunbook(book, runbookUpdates, fingerprint) };
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

  // Plan revisions use redirect; this interrupt only approves the current plan.
  function approvePlan() {
    interrupt<PipelineWaiting, { approve: true }>({ kind: "approve_plan" });
    return { planApproved: true };
  }

  async function finish() {
    await assertNoMerge(need().issueId);
    return { finished: true };
  }

  // QA's previous report is historical context for repairs, not a current approval.
  // Routing always runs Reviewer and QA again before final integration can finish.
  const invalidated = { checksReport: null, review: null, finished: false };
  async function prepare() {
    const integration = await prepareIntegration(need().issueId, need().refreshUpstream);
    return { integration, ...invalidated, qaReport: null };
  }
  async function commit(state: State) {
    if (state.implementation?.replanReason) return { ...invalidated, planApproved: false };
    await commitCoderRound(need().issueId, state.implementation?.commitMessage ?? "");
    return { ...invalidated, integration: state.integration ? { ...state.integration, status: "current" as const, conflicts: [] } : null };
  }
  async function integrate(state: State) {
    const integration = await prepareIntegration(need().issueId, need().refreshUpstream);
    if (integration.status === "deferred") throw new Error("Workspace changed outside the completed coder round; redirect to coder before integrating");
    // A merge may have completed before interruption saved the node result.
    // Compare durable target/revision evidence as well as this attempt's status.
    const changed = integration.status !== "current" ||
      Boolean(state.integration && state.integration.targetCommit !== integration.targetCommit) ||
      Boolean(state.checksReport && state.checksReport.revision !== await workspaceRevision(need().issueId));
    const attempts = (state.integrationAttempts ?? 0) + (changed ? 1 : 0);
    if (attempts > 3) throw new Error("Upstream advanced repeatedly; stopped after three integration rounds. Resume later to integrate and validate again.");
    return { integration: changed && integration.status === "current" ? { ...integration, status: "merged" as const } : integration,
      integrationAttempts: attempts, ...(changed ? { ...invalidated, planApproved: false } : {}) };
  }

  const hasQuestions = (doc: { blockingQuestions: string[] } | null) =>
    (doc?.blockingQuestions.length ?? 0) > 0;

  const tracked = <T>(node: (state: State) => Promise<T>, role?: AgentRole) => (state: State) =>
    need().execution.track(async () => {
      need().signal?.throwIfAborted();
      const started = new Date().toISOString();
      if (role) await emitForgeEvent(need().issueId, { type: "stage_started", role });
      const result = await node(state);
      need().signal?.throwIfAborted();
      const timeline = timelineEvents(role, started, result as object);
      return timeline.length ? { ...result, timeline } : result;
    });

  return new StateGraph(PipelineGraphState)
    .addNode("redirect", () => ({}))
    .addNode("prepare", tracked(prepare))
    .addNode("commit", tracked(commit))
    .addNode("integrate", tracked(integrate))
    .addNode("final_integrate", tracked(integrate))
    .addNode("planner", tracked(planner, "planner"))
    .addNode(
      "ask_planner",
      ask("planner", (s) => s.plan),
    )
    .addNode("approve_plan", approvePlan)
    .addNode("coder", tracked(coder, "coder"))
    .addNode(
      "ask_coder",
      ask("coder", (s) => s.implementation),
    )
    .addNode("reviewer", tracked(reviewer, "reviewer"))
    .addNode(
      "ask_reviewer",
      ask("reviewer", (s) => s.review),
    )
    .addNode("qa", tracked(qa, "qa"))
    .addNode(
      "ask_qa",
      ask("qa", (s) => s.qaReport),
    )
    .addNode("finish", finish)
    .addConditionalEdges("redirect", (s) => s.redirectTarget, ["planner", "coder", "reviewer", "qa"])
    .addEdge(START, "prepare")
    .addEdge("prepare", "planner")
    .addConditionalEdges("planner", (s) =>
      hasQuestions(s.plan) ? "ask_planner" : "approve_plan",
    )
    .addEdge("ask_planner", "planner")
    .addConditionalEdges("approve_plan", async s => s.plan?.steps.length || s.integration?.status === "conflicts" ||
      s.integration?.status === "deferred" || await hasUncommitted(need().issueId) ? "coder" : "reviewer")
    .addConditionalEdges("coder", (s) =>
      hasQuestions(s.implementation) ? "ask_coder" : "commit",
    )
    .addConditionalEdges("commit", s => s.implementation?.replanReason ? "planner" : "integrate")
    .addConditionalEdges("integrate", s => s.integration?.status !== "current" ? "planner" : "reviewer")
    .addEdge("ask_coder", "coder")
    .addConditionalEdges("reviewer", (s) => {
      if (hasQuestions(s.review)) return "ask_reviewer";
      if ((s.review?.requiredChanges.length ?? 0) > 0) return "coder";
      return "qa";
    })
    .addEdge("ask_reviewer", "reviewer")
    .addConditionalEdges("qa", (s) => {
      if (hasQuestions(s.qaReport)) return "ask_qa";
      return s.qaReport?.verdict !== "pass" ? "reviewer" : "final_integrate";
    })
    .addConditionalEdges("final_integrate", s => s.integration?.status !== "current" ? "planner" : "finish")
    .addEdge("ask_qa", "qa")
    .addEdge("finish", END)
    .compile({ checkpointer });
}

// ---- Running and reading it -------------------------------------------------------

// Integration and repair loops have independent bounded budgets. Allow enough graph
// steps for those loops and the approval/validation nodes.

// Starts the issue's pipeline with an optional note for the planner; the returned
// stream is the run (see startRun).
export function startPipeline(run: Run, note: string, signal?: AbortSignal) {
  run.signal = signal;
  return Promise.resolve(withPipelineEvents(run, buildPipeline(run).stream(
    { note, humanMessages: [humanMessage(note || "Started work on this issue.", run.username)] },
    streamConfig(forgeThreadId(run.issueId), 100, signal),
  )));
}

// Runs start outside whatever LangGraph run calls it, e.g. a project lead tool's.
// Inside one, the pipeline would join it as a subgraph, saving its checkpoints under
// that run's namespace (where getPipeline doesn't look) and sharing its callbacks.
export const outsideAgentRun = <T>(start: () => T) =>
  AsyncLocalStorageProviderSingleton.getInstance().run(undefined, start);

// Checks, and narrows, a reply to what the pipeline is waiting on.
export function readReply(body: unknown): PipelineResume | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).length !== 1) return null;
  if (Array.isArray(b.answers) && b.answers.every((a) => typeof a === "string")) {
    return { answers: b.answers as string[] };
  }
  if (b.approve === true) return { approve: true };
  return null;
}

// Whether a reply answers what the pipeline is waiting on.
export function replyFits(waiting: PipelineWaiting | null, reply: PipelineResume) {
  return (
    (waiting?.kind === "questions" && "answers" in reply && reply.answers.length === waiting.questions.length) ||
    (waiting?.kind === "approve_plan" && "approve" in reply)
  );
}

// Answers what the pipeline is waiting on, and carries on.
export async function resumePipeline(run: Run, reply: PipelineResume, signal?: AbortSignal) {
  run.signal = signal;
  const snapshot = await buildPipeline(null).getState(threadConfig(forgeThreadId(run.issueId)));
  const request = toWaiting(snapshot.tasks.flatMap((task) => task.interrupts)[0]?.value);
  return Promise.resolve(withPipelineEvents(run, buildPipeline(run).stream(
    new Command({ resume: reply, update: { humanMessages: [replyMessage(reply, request, run.username)] } }),
    streamConfig(forgeThreadId(run.issueId), 100, signal),
  )));
}

// Retry pending work without adding input or bypassing a human interrupt.
export function continuePipeline(run: Run, signal?: AbortSignal) {
  run.signal = signal;
  return Promise.resolve(withPipelineEvents(run, buildPipeline(run).stream(null, streamConfig(forgeThreadId(run.issueId), 100, signal))));
}

function withPipelineEvents<T>(run: Run, source: Promise<AsyncIterable<T>>) {
  return pipelineEvents(Promise.resolve(run.execution.stream(source)), async (): Promise<ForgeLifecycleEvent | null> => {
    const snapshot = await buildPipeline(null).getState(threadConfig(forgeThreadId(run.issueId)));
    const values = snapshot.values as Partial<State>;
    if (values.finished) return { type: "completed", qa: values.qaReport ?? null };
    const waiting = toWaiting(snapshot.tasks.flatMap((task) => task.interrupts)[0]?.value);
    return waiting ? { type: "waiting", waiting } : null;
  }, (event) => emitForgeEvent(run.issueId, event), run.signal, () => isRedirecting(forgeThreadId(run.issueId)));
}

const ROLE_NODES: Record<string, AgentRole> = {
  prepare: "planner",
  commit: "coder",
  integrate: "coder",
  final_integrate: "qa",
  planner: "planner",
  ask_planner: "planner",
  approve_plan: "planner",
  coder: "coder",
  ask_coder: "coder",
  ask_reviewer: "reviewer",
  ask_qa: "qa",
  finish: "qa",
  reviewer: "reviewer",
  qa: "qa",
};

export async function getPipelineMessages(issueId: string) {
  const { checkpoints } = await loadForgeHistory(checkpointer, forgeThreadId(issueId));
  const pipeline = await getPipeline(issueId);
  return checkpointMessages(checkpoints, Boolean(pipeline.running || pipeline.waiting && !pipeline.finished));
}

// Runs pause only for plan approval or questions.
function toWaiting(value: unknown): PipelineWaiting | null {
  if (!value) return null;
  return value as PipelineWaiting;
}

// Stops what the QA started in the issue's workspace: its processes and its browser.
export async function stopQa(issueId: string) {
  await stopAllProcesses(issueId);
  await closeBrowser(issueId);
}

// The workspace's setup, for the QA: the command, how it went, and the end of its log.
// The issues whose pipeline is waiting for plan approval,
// for marking them in the webapp's issue lists.
export async function pendingApprovals(): Promise<PendingApproval[]> {
  const workspaces = await Workspace.findAll({ attributes: ["issueId"] });
  const pipelines = await Promise.all(
    workspaces.map(async ({ issueId }) => ({ issueId, waiting: (await getPipeline(issueId)).waiting })),
  );
  return pipelines.flatMap(({ issueId, waiting }) =>
    waiting?.kind === "approve_plan" ? [{ issueId, kind: waiting.kind }] : [],
  );
}

// The issue's pipeline, for the webapp.
export async function getPipeline(issueId: string): Promise<PipelineState> {
  const threadId = forgeThreadId(issueId);
  const snapshot = await buildPipeline(null).getState(threadConfig(threadId));
  const values = snapshot.values as Partial<State>;
  const running = runStatus(threadId).running;
  // A running pipeline isn't waiting on you. Its saved state can still say it is: a
  // node that carries on after you answer its questions
  // keeps the pause it resumed from until it finishes or pauses again.
  const waiting = running || values.finished
    ? null
    : toWaiting(snapshot.tasks.flatMap((task) => task.interrupts)[0]?.value);
  const { error, pausing } = runStatus(threadId);
  return {
    started: Boolean(snapshot.createdAt),
    redirecting: isRedirecting(threadId),
    steeringOptions: steeringOptions(values, ROLE_NODES[snapshot.next[0] ?? ""] ?? null, Boolean(snapshot.createdAt)),
    pausing: Boolean(pausing),
    canResume: Boolean(snapshot.createdAt && snapshot.next.length && !isRunning(threadId) && !waiting && !values.finished),
    pendingRole: ROLE_NODES[snapshot.next[0] ?? ""] ?? null,
    // While a run goes on, its next node is the one working.
    running: running ? (ROLE_NODES[snapshot.next[0] ?? ""] ?? null) : null,
    waiting,
    plan: values.plan ?? null,
    planApproved: values.planApproved ?? false,
    implementation: values.implementation ?? null,
    integration: values.integration ?? null,
    checks: values.checksReport ?? null,
    environmentSetup: values.environmentReport ?? null,
    review: values.review ?? null,
    qa: values.qaReport ?? null,
    clarifications: values.clarifications ?? [],
    browserUrl: browserUrl(issueId),
    finished: values.finished ?? false,
    error,
  };
}

// Deletes the issue's pipeline, with its planner's and coder's conversations (saved on
// its thread), e.g. with its workspace.
export async function deleteConversation(issueId: string) {
  await checkpointer.deleteThread(forgeThreadId(issueId));
}

// Shared by the issue page and Project Lead. Never mutate a checkpoint while its old run drains.
export async function redirectPipeline(run: Run, request: PipelineRedirect) {
  const threadId = forgeThreadId(run.issueId);
  if (!await Workspace.findByPk(run.issueId)) throw new Error("This issue has no workspace");
  if (workspaceApps.starting(run.issueId)) throw new Error("The user app is still being prepared");
  const validate = async () => {
    const pipeline = await getPipeline(run.issueId);
    const option = pipeline.steeringOptions?.find((entry) => entry.target === request.target);
    if (!option || option.reason) throw new Error(option?.reason ?? "Invalid redirect target");
    if (request.target === "qa" &&
      pipeline.checks?.revision !== await workspaceRevision(run.issueId))
      throw new Error("The workspace changed since checks. Redirect to coder to validate it again.");
  };
  await validate();
  return withPausedRun(threadId, run.notify, async (reservation) => {
    await validate();
    await stopQa(run.issueId);
    await drainProcesses(run.issueId);
    for (const role of ["planner", "coder", "reviewer", "qa"]) pausedLogs.delete(`${run.issueId}:${role}`);
    const graph = buildPipeline(run);
    // Simulate the routing node's completion: updateState replaces pending tasks,
    // rather than adding a goto alongside a saved approval or interrupted node.
    await graph.updateState(threadConfig(threadId), {
      ...redirectUpdate(request),
      humanMessages: [humanMessage(`Redirect to ${request.target}:\n\n${request.feedback}`, run.username)],
    }, "redirect");
    return startRun(threadId, (signal) => continuePipeline(run, signal), run.notify, reservation);
  });
}
