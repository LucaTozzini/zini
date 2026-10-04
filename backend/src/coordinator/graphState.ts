import { Annotation } from "@langchain/langgraph";
import type {
  Clarification,
  ImplementationDocument,
  PlanDocument,
  QaDocument,
  ReviewDocument,
  ChecksDocument,
} from "shared";
import type { z } from "zod";
import type { CHECKS_SCHEMA } from "./documents.js";
import type { Runbook } from "./validation.js";
import type { CodebaseContext } from "./codebaseContext.js";

const latest = <T>(initial: T) =>
  Annotation<T>({ reducer: (_old, next) => next, default: () => initial });
const appended = <T>() =>
  Annotation<T[]>({
    reducer: (old, more) => old.concat(more),
    default: () => [],
  });

export const PipelineGraphState = Annotation.Root({
  // The note you started it with, for the planner.
  note: latest(""),
  plan: latest<PlanDocument | null>(null),
  planApproved: latest(false),
  implementation: latest<ImplementationDocument | null>(null),
  runbook: latest<Runbook>({}),
  checksPlan: latest<z.infer<typeof CHECKS_SCHEMA> | null>(null),
  checksReport: latest<ChecksDocument | null>(null),
  repairAttempts: latest(0),
  lastImplementationRevision: latest(""),
  review: latest<ReviewDocument | null>(null),
  // The QA's latest report. Not "qa": that's its node's name, and a graph can't use one
  // name for both.
  qaReport: latest<QaDocument | null>(null),
  // Keyed facts discovered by the roles. Each node replaces this with its merged,
  // source-checked view so later roles don't inherit stale claims.
  codebaseContext: latest<CodebaseContext>({}),
  // Every question a subagent asked and your answer; given to every subagent.
  clarifications: appended<Clarification>(),
  // Your notes on the plan (for the planner), and on the finished changes (for the
  // coder and reviewer).
  planFeedback: appended<string>(),
  implementationFeedback: appended<string>(),
  finished: latest(false),
});

export type State = typeof PipelineGraphState.State;
