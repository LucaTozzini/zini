import { Stack } from "@mui/material";
import type { PipelineResume, PipelineState } from "shared";
import { FeedbackCard, QuestionsCard, StartCard } from "./Cards.tsx";
import { PlanView } from "./Documents.tsx";

// What the Forge needs from you now, inline: starting it, the Lead's questions, or the
// plan to approve. Otherwise, once it's started and not working, a message to the Lead.
export default function PipelineRequest({ issueId, pipeline, onStart, onReply, onMessage, sending }: {
  issueId: string;
  pipeline: PipelineState;
  onStart: (note: string) => void;
  onReply: (response: PipelineResume) => void;
  onMessage: (message: string) => void;
  sending: boolean;
}) {
  if (!pipeline.started) return <StartCard issueId={issueId} onStart={onStart} loading={sending} />;
  const { waiting } = pipeline;
  if (waiting?.kind === "questions") return <QuestionsCard
    key={waiting.questions.join("\n")}
    questions={waiting.questions} onSubmit={(answers) => onReply({ answers })} loading={sending} />;
  if (waiting?.kind === "approve_plan") return <Stack spacing={2}>
    <PlanView plan={waiting.plan} />
    <FeedbackCard key={JSON.stringify(waiting.plan)} title={pipeline.planApproved ? "Approve this change to the plan?" : "Approve the plan?"}
      placeholder="Or describe what to change, and the Lead will revise it."
      feedbackLabel="Send feedback" onApprove={() => onReply({ approve: true })}
      onFeedback={(feedback) => onReply({ feedback })} loading={sending} />
  </Stack>;
  if (pipeline.running || pipeline.pausing) return null;
  return <FeedbackCard key={String(pipeline.finished)} title={pipeline.finished ? "Request changes" : "Message the Lead"}
    placeholder={pipeline.finished ? "Describe what to change. The Lead will plan, build and review it." : "Tell the Lead what to do next."}
    feedbackLabel="Send" onFeedback={onMessage} loading={sending} />;
}
