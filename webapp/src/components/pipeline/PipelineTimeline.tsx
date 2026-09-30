import type { ReactNode } from "react";
import { Stack } from "@mui/material";
import type { AgentRole, PipelineState, WorkspaceDiff } from "shared";
import { FeedbackCard, QuestionsCard, StartCard } from "./Cards.tsx";
import DiffView from "./DiffView.tsx";
import { ClarificationList, PlanView, ReviewView } from "./Documents.tsx";
import StageSection, { type StageStatus } from "./StageSection.tsx";

export type PipelineActions = {
  onStart: (note: string) => void;
  onAnswer: (answers: string[]) => void;
  onApprovePlan: () => void;
  onPlanFeedback: (feedback: string) => void;
  onImplementationFeedback: (feedback: string) => void;
  // A reply is being sent: its card shows it's loading.
  sending: boolean;
};

function stageStatus(pipeline: PipelineState, role: AgentRole, hasDocument: boolean): StageStatus {
  if (pipeline.running === role) return "working";
  if (pipeline.waiting?.kind === "questions" && pipeline.waiting.from === role) return "needs_you";
  if (role === "planner" && pipeline.waiting?.kind === "approve_plan") return "needs_you";
  if (role === "planner" && pipeline.planApproved) return "approved";
  if (role === "reviewer" && pipeline.review?.requiredChanges.length) return "changes_requested";
  return hasDocument ? "done" : "waiting";
}

// The pipeline as a timeline: a section per subagent with its latest document, and
// below the current one the card that's waiting on you. diff is the workspace's changes
// so far (the coder's work, over all its rounds). ship is shown once it's finished,
// for committing and pushing the changes and opening a pull request.
function PipelineTimeline({
  pipeline,
  diff,
  actions,
  ship,
}: {
  pipeline: PipelineState;
  diff: WorkspaceDiff | undefined;
  actions: PipelineActions;
  ship?: ReactNode;
}) {
  const { waiting, clarifications } = pipeline;
  const askedBy = (role: AgentRole) => clarifications.filter((c) => c.from === role);
  const questionsFrom = (role: AgentRole) =>
    waiting?.kind === "questions" && waiting.from === role && (
      <QuestionsCard
        // A new set of questions starts with empty answers.
        key={waiting.questions.join("\n")}
        questions={waiting.questions}
        onSubmit={actions.onAnswer}
        loading={actions.sending}
      />
    );

  if (!pipeline.started) {
    return (
      <StageSection title="Planner" status="waiting" active>
        <StartCard onStart={actions.onStart} loading={actions.sending} />
      </StageSection>
    );
  }

  const planner = stageStatus(pipeline, "planner", Boolean(pipeline.plan));
  const coder = stageStatus(pipeline, "coder", Boolean(pipeline.implementation));
  const reviewer = stageStatus(pipeline, "reviewer", Boolean(pipeline.review));
  // The stage that's working or waiting on you starts open; the others start closed.
  // Once the pipeline is done, the coder (its changes) and Finished are open.
  const isActive = (status: StageStatus) =>
    !pipeline.finished && (status === "working" || status === "needs_you");
  const coderActive = pipeline.finished || isActive(coder);
  // What a subagent's section shows, or undefined if nothing yet (it can't be opened).
  const content = (role: AgentRole, document: ReactNode) =>
    askedBy(role).length > 0 || document || questionsFrom(role) ? (
      <>
        <ClarificationList clarifications={askedBy(role)} />
        {document}
        {questionsFrom(role)}
      </>
    ) : undefined;

  return (
    <Stack spacing={2}>
      <StageSection
        key={`planner-${isActive(planner)}`}
        title="Planner"
        status={planner}
        active={isActive(planner)}
      >
        {content(
          "planner",
          pipeline.plan && (
            <>
              <PlanView plan={pipeline.plan} />
              {waiting?.kind === "approve_plan" && (
                <FeedbackCard
                  title="Approve the plan?"
                  placeholder="Or say what to change, and the planner will revise it"
                  feedbackLabel="Send feedback"
                  onApprove={actions.onApprovePlan}
                  onFeedback={actions.onPlanFeedback}
                  loading={actions.sending}
                />
              )}
            </>
          ),
        )}
      </StageSection>

      {pipeline.planApproved && (
        <StageSection key={`coder-${coderActive}`} title="Coder" status={coder} active={coderActive}>
          {/* Its work is the workspace's changes, which grow as it writes files. */}
          {content("coder", diff?.diff && <DiffView diff={diff.diff} truncated={diff.truncated} />)}
        </StageSection>
      )}

      {(pipeline.review || pipeline.running === "reviewer") && (
        <StageSection
          key={`reviewer-${isActive(reviewer)}`}
          title="Reviewer"
          status={reviewer}
          active={isActive(reviewer)}
        >
          {content("reviewer", pipeline.review && <ReviewView review={pipeline.review} />)}
        </StageSection>
      )}

      {pipeline.finished && (
        <StageSection title="Finished" status="done" active>
          {ship}
          {waiting?.kind === "feedback" && (
            <FeedbackCard
              title="Anything to change?"
              placeholder="Describe what to change, and the coder will make it (the reviewer checks it too)"
              feedbackLabel="Send to coder"
              onFeedback={actions.onImplementationFeedback}
              loading={actions.sending}
            />
          )}
        </StageSection>
      )}
    </Stack>
  );
}

export default PipelineTimeline;
