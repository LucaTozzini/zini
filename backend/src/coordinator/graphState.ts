import { Annotation } from "@langchain/langgraph";
import type {
  Clarification,
  ImplementationDocument,
  PlanDocument,
  ReviewDocument,
} from "shared";

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
  review: latest<ReviewDocument | null>(null),
  // Every question a subagent asked and your answer; given to every subagent.
  clarifications: appended<Clarification>(),
  // Your notes on the plan (for the planner), and on the finished changes (for the
  // coder and reviewer).
  planFeedback: appended<string>(),
  implementationFeedback: appended<string>(),
  finished: latest(false),
});

export type State = typeof PipelineGraphState.State;
