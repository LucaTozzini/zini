import { useState, type FormEvent } from "react";
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import type { Decision, PendingCommand } from "shared";

// The cards the pipeline shows when it's waiting on you.

export function CardFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2, borderColor: "warning.main" }}>
      <Typography variant="subtitle2" sx={{ mb: 3 }} gutterBottom>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

// Starts the pipeline, with an optional note for the planner.
export function StartCard({ onStart, loading }: { onStart: (note: string) => void; loading?: boolean }) {
  const [note, setNote] = useState("");
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onStart(note.trim());
  }
  return (
    <Stack component="form" spacing={1.5} onSubmit={handleSubmit}>
      <Typography variant="body2" color="text.secondary">
        The planner plans the issue in this workspace. You answer its questions and approve the
        plan, then the coder implements it, the reviewer checks it, and the QA runs it to test
        the changes (you approve each command it runs).
      </Typography>
      <TextField
        size="small"
        multiline
        minRows={2}
        label="Note for the planner (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Stack direction="row">
        <Button type="submit" variant="contained" loading={loading}>
          Start
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
            <Typography component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
              {command.command}
            </Typography>
          </Box>
        ))}
        <TextField
          size="small"
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
