import { useState } from "react";
import { Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import { PRIORITY_NAMES, type Decision, type PendingAction } from "shared";
import MarkdownText from "./MarkdownText.tsx";

// One reply_to_pipeline call: what will be sent to the issue's coordinator.
function PipelineReplyDetails({ action }: { action: PendingAction }) {
  const { issueId, answers, approve, feedback } = action.args as {
    issueId: string;
    answers?: string[];
    approve?: boolean;
    feedback?: string;
  };
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">Reply to the coordinator for {issueId}</Typography>
      {answers && (
        // Each answer under the question it's for (when known), matched by position.
        <Stack component="ol" sx={{ m: 0, pl: 3 }}>
          {answers.map((answer, i) => (
            <li key={i}>
              {action.questions?.[i] && <MarkdownText>{action.questions[i]}</MarkdownText>}
              <MarkdownText color="text.secondary">{answer}</MarkdownText>
            </li>
          ))}
        </Stack>
      )}
      {approve && <Typography color="text.secondary">Approve the plan</Typography>}
      {feedback && <MarkdownText color="text.secondary">{feedback}</MarkdownText>}
    </Stack>
  );
}

// One commit_and_push call: the commit message, if there's anything to commit.
function CommitDetails({ action }: { action: PendingAction }) {
  const { issueId, message } = action.args as { issueId: string; message?: string };
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">Commit and push the workspace for {issueId}</Typography>
      {message ? (
        <Typography component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
          {message}
        </Typography>
      ) : (
        <Typography color="text.secondary">Push only, no new commit</Typography>
      )}
    </Stack>
  );
}

// One create_issue or update_issue call, shown field by field.
function ActionDetails({ action }: { action: PendingAction }) {
  if (action.name === "reply_to_pipeline") return <PipelineReplyDetails action={action} />;
  if (action.name === "commit_and_push") return <CommitDetails action={action} />;
  const { id, title, description, priority, status, assignee } = action.args as {
    id?: string;
    title?: string;
    description?: string;
    priority?: number;
    status?: string;
    assignee?: string | null; // null: unassign
  };
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">
        {action.name === "update_issue" ? `Update ${id}` : "Create issue"}
      </Typography>
      {title && <Typography>{title}</Typography>}
      {priority !== undefined && (
        <Typography color="text.secondary">
          Priority: {PRIORITY_NAMES[priority] ?? priority}
        </Typography>
      )}
      {status && <Typography color="text.secondary">Status: {status}</Typography>}
      {assignee !== undefined && (
        <Typography color="text.secondary">Assignee: {assignee ?? "Unassigned"}</Typography>
      )}
      {description && <MarkdownText color="text.secondary">{description}</MarkdownText>}
    </Stack>
  );
}

// The agent's paused tool calls. Approve or reject applies to all of them at once.
function ApprovalCard({
  actions,
  loading,
  onDecide,
}: {
  actions: PendingAction[];
  loading: boolean;
  onDecide: (decision: Decision) => void;
}) {
  const [note, setNote] = useState("");

  return (
    <Card variant="outlined" sx={{ borderColor: "warning.main" }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Approve these actions?</Typography>
          {actions.map((action, i) => (
            <ActionDetails key={i} action={action} />
          ))}
          <TextField
            size="small"
            placeholder="Optional note if rejecting, e.g. make it high priority"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              loading={loading}
              onClick={() => onDecide({ type: "approve" })}
            >
              Approve
            </Button>
            <Button
              color="error"
              disabled={loading}
              onClick={() =>
                onDecide({ type: "reject", message: note.trim() || undefined })
              }
            >
              Reject
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default ApprovalCard;
