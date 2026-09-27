import type { LinearClient } from "@linear/sdk";
import { Command, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, toolStrategy } from "langchain";
import type { AgentRole, PipelineResume, PipelineState, PipelineWaiting } from "shared";
import { z } from "zod";
import { checkpointer, streamConfig, threadConfig, toolErrors } from "./agents.js";
import {
  IMPLEMENTATION_SCHEMA,
  PLAN_SCHEMA,
  REVIEW_SCHEMA,
} from "./coordinator/documents.js";
import { PipelineGraphState, type State } from "./coordinator/graphState.js";
import {
  clarificationsText,
  inputText,
  listText,
  planText,
} from "./coordinator/inputs.js";
import { logTo, openRunLog } from "./coordinator/runLog.js";
import {
  CODER_PROMPT,
  PLANNER_PROMPT,
  REVIEWER_PROMPT,
} from "./coordinator/systemPrompts.js";
import { diffTool, readTools, writeTools } from "./coordinator/tools.js";
import { fetchLinearIssue } from "./linear.js";
import { OPENROUTER_URL } from "./openrouter.js";
import { isRunning, runStatus } from "./runs.js";

// The coordinator: a fixed pipeline per issue, run as a LangGraph graph in the issue's
// workspace. The planner plans (it can ask you questions), you approve the plan (or
// send feedback), then the coder and reviewer loop until the review requires no
// changes. You can then send feedback on the changes, which runs the coder and
// reviewer again. Each subagent is its own agent with its own tools, and returns a
// document (see coordinator/documents.ts). It pauses (interrupt) whenever it needs you.

export type Setup = {
  linear: LinearClient;
  openRouterKey: string;
  model: string;
};

// One pipeline per issue, so the issue id is enough to find it.
export const coordinatorThreadId = (issueId: string) =>
  `coordinator:${issueId}`;

// Runs a subagent to completion and returns its document. Not checkpointed: only the
// document is kept, in the pipeline's state. Each run is logged (see runLog.ts).
async function runSubagent<S extends z.ZodObject>(
  { setup, issueId }: Run,
  {
    role,
    prompt,
    tools,
    schema,
    input,
  }: {
    role: AgentRole;
    prompt: string;
    tools: StructuredToolInterface[];
    schema: S;
    input: string;
  },
): Promise<z.infer<S>> {
  const log = await openRunLog(issueId, role);
  await log.write({ event: "start", role, model: setup.model, prompt, input });
  const agent = createAgent({
    model: new ChatOpenAI({
      model: setup.model,
      apiKey: setup.openRouterKey,
      configuration: { baseURL: OPENROUTER_URL },
    }),
    tools,
    systemPrompt: prompt,
    responseFormat: toolStrategy(schema),
    middleware: [logTo(log), toolErrors],
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
    await log.write({ event: "end", outcome: "error", error: String(err) });
    throw err;
  }
}

// ---- The graph -------------------------------------------------------------------

// What running a node needs. Absent when the graph is only read (getPipeline).
type Run = { setup: Setup; issueId: string; notify: () => void };

function buildPipeline(run: Run | null) {
  const need = () => {
    if (!run) throw new Error("The pipeline can't run without its setup");
    return run;
  };
  const issue = () => fetchLinearIssue(need().setup.linear, need().issueId);

  async function planner(state: State) {
    const { issueId } = need();
    const plan = await runSubagent(need(), {
      role: "planner",
      prompt: PLANNER_PROMPT,
      tools: readTools(issueId),
      schema: PLAN_SCHEMA,
      input: inputText(await issue(), [
        ["Note from the user", state.note],
        ["Your previous plan", state.plan && planText(state.plan)],
        ["The user's answers", clarificationsText(state.clarifications)],
        [
          "The user's feedback on your plan (address it)",
          state.planFeedback.length > 0 && listText(state.planFeedback),
        ],
      ]),
    });
    return { plan, planApproved: false };
  }

  async function coder(state: State) {
    const { issueId, notify } = need();
    const changes = state.review?.requiredChanges ?? [];
    const implementation = await runSubagent(need(), {
      role: "coder",
      prompt: CODER_PROMPT,
      tools: [
        ...readTools(issueId),
        ...writeTools(issueId, notify),
        diffTool(issueId),
      ],
      schema: IMPLEMENTATION_SCHEMA,
      input: inputText(await issue(), [
        ["The approved plan", state.plan && planText(state.plan)],
        ["The user's answers", clarificationsText(state.clarifications)],
        [
          "Required changes from the review (make these)",
          changes.length > 0 && listText(changes),
        ],
        [
          "The user's feedback on the changes (apply it)",
          state.implementationFeedback.length > 0 &&
            listText(state.implementationFeedback),
        ],
      ]),
    });
    return { implementation };
  }

  async function reviewer(state: State) {
    const { issueId } = need();
    const review = await runSubagent(need(), {
      role: "reviewer",
      prompt: REVIEWER_PROMPT,
      tools: [...readTools(issueId), diffTool(issueId)],
      schema: REVIEW_SCHEMA,
      input: inputText(await issue(), [
        ["The approved plan", state.plan && planText(state.plan)],
        ["The user's answers", clarificationsText(state.clarifications)],
        [
          "The user's feedback on the changes (they must be applied too)",
          state.implementationFeedback.length > 0 &&
            listText(state.implementationFeedback),
        ],
      ]),
    });
    return { review };
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
      return (s.review?.requiredChanges.length ?? 0) > 0 ? "coder" : "finish";
    })
    .addEdge("ask_reviewer", "reviewer")
    .addEdge("finish", "await_feedback")
    .addEdge("await_feedback", "coder")
    .compile({ checkpointer });
}

// ---- Running and reading it -------------------------------------------------------

// Starts the issue's pipeline with an optional note for the planner; the returned
// stream is the run (see startRun).
export function startPipeline(run: Run, note: string) {
  return buildPipeline(run).stream(
    { note },
    streamConfig(coordinatorThreadId(run.issueId)),
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
};

// The issue's pipeline, for the webapp.
export async function getPipeline(issueId: string): Promise<PipelineState> {
  const threadId = coordinatorThreadId(issueId);
  const snapshot = await buildPipeline(null).getState(threadConfig(threadId));
  const values = snapshot.values as Partial<State>;
  const waiting =
    (snapshot.tasks.flatMap((task) => task.interrupts)[0]?.value as
      | PipelineWaiting
      | undefined) ?? null;
  const { error } = runStatus(threadId);
  return {
    started: Boolean(snapshot.createdAt),
    // While a run goes on, its next node is the one working.
    running: isRunning(threadId)
      ? (ROLE_NODES[snapshot.next[0] ?? ""] ?? null)
      : null,
    waiting,
    plan: values.plan ?? null,
    planApproved: values.planApproved ?? false,
    implementation: values.implementation ?? null,
    review: values.review ?? null,
    clarifications: values.clarifications ?? [],
    finished: values.finished ?? false,
    error,
  };
}

// Deletes the issue's pipeline, e.g. with its workspace.
export async function deleteConversation(issueId: string) {
  await checkpointer.deleteThread(coordinatorThreadId(issueId));
}
