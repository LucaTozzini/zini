import { Alert, Stack } from "@mui/material";
import type { PipelineResume, PipelineState } from "shared";
import { CommandsCard, FeedbackCard, QuestionsCard, StartCard } from "./Cards.tsx";
import { PlanView } from "./Documents.tsx";

// Only the current blocking request is inline. Historical documents live in the step dialogs.
export default function PipelineRequest({ issueId, pipeline, onStart, onReply, sending }: {
  issueId: string;
  pipeline: PipelineState;
  onStart: (note: string) => void;
  onReply: (response: PipelineResume) => void;
  sending: boolean;
}) {
  if (!pipeline.started) return <StartCard issueId={issueId} onStart={onStart} loading={sending} />;
  const { waiting } = pipeline;
  if (waiting?.kind === "questions") return <QuestionsCard
    key={`${waiting.from}-${waiting.questions.join("\n")}`}
    questions={waiting.questions} onSubmit={(answers) => onReply({ answers })} loading={sending} />;
  if (waiting?.kind === "approve_commands") return <CommandsCard
    key={`${waiting.from}-${waiting.commands.map((command) => command.command).join("\n")}`}
    commands={waiting.commands}
    onDecide={(decision) => onReply({ decisions: waiting.commands.map(() => decision) })}
    loading={sending} />;
  if (waiting?.kind === "approve_plan") return <Stack spacing={2}>
    {pipeline.plan ? <PlanView plan={pipeline.plan} /> : <Alert severity="warning">The plan document is unavailable.</Alert>}
    <FeedbackCard key={JSON.stringify(pipeline.plan)} title="Approve the plan?"
      placeholder="Or describe what to change, and the planner will revise it."
      feedbackLabel="Send feedback" onApprove={pipeline.plan ? () => onReply({ approve: true }) : undefined}
      onFeedback={(feedback) => onReply({ feedback })} loading={sending} />
  </Stack>;
  return null;
}
