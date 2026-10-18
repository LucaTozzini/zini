import { Stack } from "@mui/material";
import type { ForgeResume, ForgeState } from "shared";
import { FeedbackCard, QuestionsCard, StartCard } from "./Cards.tsx";
import { PlanView } from "./Documents.tsx";

// What the Forge needs from you now, inline: starting it, the Lead's questions, or the
// plan to approve. Other messages to the Lead go through the chat input below.
export default function ForgeRequest({
  issueId,
  forge,
  onStart,
  onReply,
  sending,
}: {
  issueId: string;
  forge: ForgeState;
  onStart: (note: string) => void;
  onReply: (response: ForgeResume) => void;
  sending: boolean;
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
  if (waiting?.kind === "approve_plan")
    return (
      <Stack spacing={2}>
        <PlanView plan={waiting.plan} />
        <FeedbackCard
          key={JSON.stringify(waiting.plan)}
          title={forge.planApproved ? "Approve this change to the plan?" : "Approve the plan?"}
          placeholder="Or describe what to change, and the Lead will revise it."
          feedbackLabel="Send feedback"
          onApprove={() => onReply({ approve: true })}
          onFeedback={(feedback) => onReply({ feedback })}
          loading={sending}
        />
      </Stack>
    );
  return null;
}
