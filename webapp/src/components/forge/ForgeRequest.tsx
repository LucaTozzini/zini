import type { ForgeResume, ForgeState } from "shared";
import { QuestionsCard, StartCard } from "./Cards.tsx";
import PlanReview from "./PlanReview.tsx";

// What the Forge needs from you now, inline: starting it, the Lead's questions, or the
// plan to review. Other messages to the Lead go through the chat input below.
export default function ForgeRequest({
  issueId,
  forge,
  onStart,
  onReply,
  onApprove,
  onFeedback,
  sending,
  error,
}: {
  issueId: string;
  forge: ForgeState;
  onStart: (note: string) => void;
  onReply: (response: ForgeResume) => void;
  onApprove: (revision: number) => Promise<unknown>;
  onFeedback: (message: string) => Promise<unknown>;
  sending: boolean;
  error: Error | null;
}) {
  if (!forge.started) return <StartCard issueId={issueId} onStart={onStart} loading={sending} />;
  const { waiting } = forge;
  if (waiting?.kind === "questions")
    return (
      <QuestionsCard
        key={waiting.questions.join("\n")}
        questions={waiting.questions}
        onSubmit={(answers) => onReply({ answers })}
        loading={sending}
      />
    );
  // A plan the Lead saved and stopped on: it waits for your approval.
  if (forge.plan && !forge.planApproved && !forge.running && !forge.pausing)
    return <PlanReview plan={forge.plan} onApprove={onApprove} onFeedback={onFeedback} loading={sending} error={error} />;
  return null;
}
