import { Annotation } from "@langchain/langgraph";
import type {
  Clarification,
  SteeringTarget,
  ImplementationDocument,
  PlanDocument,
  QaDocument,
  ReviewDocument,
  ChecksDocument,
  ForgeHumanMessage,
  EnvironmentSetupDocument,
  IntegrationState,
} from "shared";
import type { Runbook } from "./validation.js";

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
  redirectTarget: latest<SteeringTarget>("planner"),
  steeringFeedback: appended<string>(),
  humanMessages: appended<ForgeHumanMessage>(),
  plan: latest<PlanDocument | null>(null),
  planApproved: latest(false),
  implementation: latest<ImplementationDocument | null>(null),
  runbook: latest<Runbook>({}),
  environmentReport: latest<EnvironmentSetupDocument | null>(null),
  checksReport: latest<ChecksDocument | null>(null),
  review: latest<ReviewDocument | null>(null),
  // The QA's latest report, retained through repairs as historical retest context.
  // Not "qa": that's its node's name, and a graph can't use one
  // name for both.
  qaReport: latest<QaDocument | null>(null),
  // Every question a subagent asked and your answer; given to every subagent.
  clarifications: appended<Clarification>(),
  // Your notes on the plan (for the planner), and on the finished changes (for the
  // coder and reviewer).
  planFeedback: appended<string>(),
  implementationFeedback: appended<string>(),
  finished: latest(false),
  integration: latest<IntegrationState | null>(null),
  integrationAttempts: latest(0),
});

export type State = typeof PipelineGraphState.State;
