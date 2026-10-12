import type { AgentRole, PipelineRedirect, SteeringOption, SteeringTarget } from "shared";
import type { State } from "./graphState.js";

export const STEERING_TARGETS = ["planner", "coder", "reviewer", "qa"] as const;
const rank: Record<AgentRole, number> = { planner: 0, coder: 1, reviewer: 2, qa: 3 };

export function steeringOptions(state: Partial<State>, current: AgentRole | null, started: boolean): SteeringOption[] {
  return STEERING_TARGETS.map((target) => {
    let reason: string | null = null;
    if (!started) reason = "Start the Forge first.";
    else if (target !== "planner" && !state.finished && (!current || rank[target] > rank[current])) reason = "Cannot jump ahead of the current stage.";
    else if (target !== "planner" && (!state.plan || !state.planApproved)) reason = "An approved plan is required.";
    else if ((target === "reviewer" || target === "qa") && ((!state.implementation && Boolean(state.plan?.steps.length)) || state.implementation?.blockingQuestions.length))
      reason = "Completed implementation is required.";
    else if (target === "qa" && (!state.checksReport?.complete || !state.review || state.review.blockingQuestions.length || state.review.requiredChanges.length))
      reason = "Completed reviewer validation without defects or environment blockers is required.";
    return { target, reason };
  });
}

export function redirectUpdate({ target, feedback }: PipelineRedirect): Partial<State> {
  const update: Partial<State> = { redirectTarget: target, steeringFeedback: [`Redirect to ${target}: ${feedback}`],
    finished: false, integrationAttempts: 0 };
  if (target !== "qa") update.review = null;
  if (target === "planner" || target === "coder") Object.assign(update, {
    implementation: null, checksReport: null,
  });
  if (target === "planner") Object.assign(update, { plan: null, planApproved: false, planFeedback: [feedback] });
  if (target === "coder") update.implementationFeedback = [feedback];
  return update;
}

export function readRedirect(value: unknown): PipelineRedirect | null {
  if (!value || typeof value !== "object") return null;
  const { target, feedback } = value as Record<string, unknown>;
  return STEERING_TARGETS.includes(target as SteeringTarget) && typeof feedback === "string" && feedback.trim()
    ? { target: target as SteeringTarget, feedback: feedback.trim() } : null;
}
