import { useState, type FormEvent } from "react";
import { Alert, Box, Button, Paper, Skeleton, Stack, TextField, Typography } from "@mui/material";
import type { Decision, PendingCommand } from "shared";
import { errorMessage } from "../../api/client.ts";
import { useCreateWorkspace, useRerunSetup, useWorkspace } from "../../api/workspaces.ts";

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
  const rerun = useRerunSetup();
  const settingUp = workspace.data?.setupStatus === "running";
  const failed = workspace.data?.setupStatus === "failed";
  const ready = workspace.data?.setupStatus === "ready";
  const busy = Boolean(loading || create.isPending || rerun.isPending || settingUp);
  const failure = create.error ?? rerun.error;
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !workspace.isSuccess) return;
    if (workspace.data === null) create.mutate(issueId);
    else if (failed) rerun.mutate(issueId);
    else if (ready) onStart(note.trim());
  }
  if (workspace.isPending) return <Skeleton height={100} />;
  if (workspace.isError) return <Alert severity="error" action={<Button onClick={() => workspace.refetch()}>Retry</Button>}>
    {errorMessage(workspace.error)}
  </Alert>;
  return (
    <Stack component="form" spacing={1.5} onSubmit={handleSubmit}>
      <Typography variant="body2" color="text.secondary">
        {workspace.data === null ? "Create a workspace for this issue before starting the coordinator." :
          "You’ll be asked to approve the plan and any commands that need permission."}
      </Typography>
      {failed && <Alert severity="error">Workspace setup failed: {workspace.data?.setupError ?? "Unknown error"}</Alert>}
      {failure && <Alert severity="error">{errorMessage(failure)}</Alert>}
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
          {settingUp ? "Setting up workspace" : workspace.data === null ? "Create workspace" : failed ? "Retry setup" : "Start"}
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

// The commands the QA wants to run on this machine. Approve or reject applies to all of
// them; a reject's note tells the QA why (e.g. what to run instead).
export function CommandsCard({
  commands,
  onDecide,
  loading,
}: {
  commands: PendingCommand[];
  onDecide: (decision: Decision) => void;
  loading?: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <CardFrame title={commands.length === 1 ? "Run this command?" : "Run these commands?"}>
      <Stack spacing={2}>
        {commands.map((command, i) => (
          <Box key={i}>
            <Typography variant="caption" color="text.secondary">
              {command.tool === "start_process" ? "Start, and leave running" : "Run"}
            </Typography>
            <Typography component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "monospace" }}>
              {command.command}
            </Typography>
          </Box>
        ))}
        <TextField
          size="small"
          slotProps={{ htmlInput: { "aria-label": "Reason for rejecting commands (optional)" } }}
          placeholder="Optional note if rejecting, e.g. use npm test -- --run instead"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Stack direction="row" spacing={1}>
          <Button variant="contained" loading={loading} onClick={() => onDecide({ type: "approve" })}>
            Approve
          </Button>
          <Button
            color="error"
            disabled={loading}
            onClick={() => onDecide({ type: "reject", message: note.trim() || undefined })}
          >
            Reject
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
