import type { PipelineState } from "shared";

export const PIPELINE_STEPS = [
  { role: "planner", label: "Plan" },
  { role: "coder", label: "Code" },
  { role: "checks", label: "Checks" },
  { role: "reviewer", label: "Review" },
  { role: "qa", label: "QA" },
] as const;

function activeStep(pipeline: PipelineState) {
  // A repair can revisit an earlier role while later reports still exist.
  if (pipeline.running) return PIPELINE_STEPS.findIndex((step) => step.role === pipeline.running);
  if (pipeline.canResume && pipeline.pendingRole) return PIPELINE_STEPS.findIndex((step) => step.role === pipeline.pendingRole);
  const { waiting } = pipeline;
  if (waiting?.kind === "questions") return PIPELINE_STEPS.findIndex((step) => step.role === waiting.from);
  if (waiting?.kind === "approve_plan") return 0;
  if (waiting?.kind === "approve_commands") return waiting.from === "checks" ? 2 : 4;
  if (pipeline.finished) return 4;
  if (!pipeline.planApproved) return 0;
  if (!pipeline.implementation) return 1;
  if (!pipeline.checks) return 2;
  if (!pipeline.review) return 3;
  if (!pipeline.error && (pipeline.review.requiredChanges.length > 0 || pipeline.qa?.verdict === "fail")) return 1;
  return 4;
}

// Legacy runs may have reached review/QA without saving a checks report.
export function checksSkipped(pipeline: PipelineState) {
  return !pipeline.checks && activeStep(pipeline) > 2;
}
