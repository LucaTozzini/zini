import type { AgentRole, PipelineRedirect, SteeringOption, SteeringTarget } from "shared";
import type { State } from "./graphState.js";

export const STEERING_TARGETS = ["planner", "coder", "reviewer", "qa"] as const;
const rank: Record<AgentRole, number> = { planner: 0, coder: 1, setup: 2, checks: 3, reviewer: 4, qa: 5 };

export function steeringOptions(state: Partial<State>, current: AgentRole | null, started: boolean): SteeringOption[] {
  return STEERING_TARGETS.map((target) => {
    let reason: string | null = null;
    if (!started) reason = "Start the Forge first.";
    else if (target !== "planner" && !state.finished && (!current || rank[target] > rank[current])) reason = "Cannot jump ahead of the current stage.";
    else if (target !== "planner" && (!state.plan || !state.planApproved)) reason = "An approved plan is required.";
    else if ((target === "reviewer" || target === "qa") && (!state.implementation || state.implementation.blockingQuestions.length ||
      !state.environmentReport?.complete || state.environmentReport.blockingQuestions.length || !state.checksReport?.complete))
      reason = "Completed implementation, environment setup, and checks are required.";
    else if (target === "qa" && (!state.review || state.review.blockingQuestions.length || state.review.requiredChanges.length))
      reason = "A completed review without required changes is required.";
    return { target, reason };
  });
}

export function redirectUpdate({ target, feedback }: PipelineRedirect): Partial<State> {
  const update: Partial<State> = { redirectTarget: target, steeringFeedback: [`Redirect to ${target}: ${feedback}`],
    finished: false, repairAttempts: 0, qaReport: null };
  if (target !== "qa") update.review = null;
  if (target === "planner" || target === "coder") Object.assign(update, {
    implementation: null, environmentPlan: null, environmentReport: null, checksPlan: null, checksReport: null,
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
