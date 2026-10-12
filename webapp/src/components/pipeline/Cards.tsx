import { useState, type FormEvent } from "react";
import { Alert, Box, Button, Paper, Skeleton, Stack, TextField, Typography } from "@mui/material";

import { errorMessage } from "../../api/client.ts";
import { useCreateWorkspace, useWorkspace } from "../../api/workspaces.ts";
import { WorkspaceChoices } from "../WorkspaceChoices.tsx";

// The cards the pipeline shows when it's waiting on you.

export function CardFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

// Starts the pipeline, with an optional note for the planner.
export function StartCard({ issueId, onStart, loading }: { issueId: string; onStart: (note: string) => void; loading?: boolean }) {
  const [note, setNote] = useState("");
  const workspace = useWorkspace(issueId);
  const create = useCreateWorkspace();
  const ready = Boolean(workspace.data);
  const busy = Boolean(loading || create.isPending);
  const failure = create.error;
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !workspace.isSuccess) return;
    if (workspace.data === null) create.mutate(issueId);
    else if (ready) onStart(note.trim());
  }
  if (workspace.isPending) return <Skeleton height={100} />;
  if (workspace.isError) return <Alert severity="error" action={<Button onClick={() => workspace.refetch()}>Retry</Button>}>
    {errorMessage(workspace.error)}
  </Alert>;
  return (
    <Stack component="form" spacing={1.5} onSubmit={handleSubmit}>
      <Typography variant="body2" color="text.secondary">
        {workspace.data === null ? "Create a workspace for this issue before starting the forge." :
          "You’ll be asked to approve the plan and any commands that need permission."}
      </Typography>
      {failure && <Alert severity="error">{errorMessage(failure)}</Alert>}
      <WorkspaceChoices error={failure} busy={busy} choose={selection => create.mutate({ issueId, ...selection })} />
      {ready && <TextField
        size="small"
        multiline
        minRows={2}
        label="Note for the planner (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />}
      <Stack direction="row">
        <Button type="submit" variant="contained" loading={busy}>
          {workspace.data === null ? "Create workspace" : "Start"}
        </Button>
      </Stack>
    </Stack>
  );
}

// A stage's blocking questions, one answer box each. All must be answered.
export function QuestionsCard({
  questions,
  onSubmit,
  loading,
}: {
  questions: string[];
  onSubmit: (answers: string[]) => void;
  loading?: boolean;
}) {
  const [answers, setAnswers] = useState(() => questions.map(() => ""));
  const complete = answers.every((a) => a.trim());

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (complete) onSubmit(answers.map((a) => a.trim()));
  }

  return (
    <CardFrame title="Questions before continuing">
      <Stack component="form" spacing={2} onSubmit={handleSubmit}>
        {questions.map((question, i) => (
          // The question as its own text, not the input's label, so a long one has room.
          <Box key={i}>
            <Typography variant="body1" gutterBottom>{question}</Typography>
            <TextField
              size="small"
              multiline
              minRows={2}
              fullWidth
              value={answers[i]}
              onChange={(e) => setAnswers((a) => a.map((old, j) => (j === i ? e.target.value : old)))}
              placeholder="Your answer, or “you decide”"
              slotProps={{ htmlInput: { "aria-label": question } }}
            />
          </Box>
        ))}
        <Stack direction="row">
          <Button type="submit" variant="contained" disabled={!complete} loading={loading}>
            Submit answers
          </Button>
        </Stack>
      </Stack>
    </CardFrame>
  );
}

// Feedback that makes the stage run again. With onApprove, also a way to approve and
// move on (the plan); without, feedback only (the finished changes).
export function FeedbackCard({
  title,
  placeholder,
  feedbackLabel,
  onFeedback,
  onApprove,
  loading,
}: {
  title: string;
  placeholder: string;
  feedbackLabel: string;
  onFeedback: (feedback: string) => void;
  onApprove?: () => void;
  loading?: boolean;
}) {
  const [feedback, setFeedback] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (feedback.trim()) onFeedback(feedback.trim());
  }

  return (
    <CardFrame title={title}>
      <Stack component="form" spacing={2} onSubmit={handleSubmit}>
        <TextField
          size="small"
          multiline
          minRows={2}
          slotProps={{ htmlInput: { "aria-label": title } }}
          placeholder={placeholder}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <Stack direction="row" spacing={1}>
          {onApprove && (
            <Button variant="contained" disabled={loading} onClick={onApprove}>
              Approve
            </Button>
          )}
          <Button type="submit" disabled={!feedback.trim()} loading={loading}>
            {feedbackLabel}
          </Button>
        </Stack>
      </Stack>
    </CardFrame>
  );
}
