import { useRef, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Popover,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { ForgePlan } from "shared";
import { errorMessage } from "../../api/client.ts";
import { CardFrame } from "./Cards.tsx";
import { PlanView } from "./Documents.tsx";

// A comment on part of the plan: the text the user selected, and what they said about it.
type Comment = { quote: string; text: string };

// The feedback message to the Lead: each comment under the part it's about, quoted. The
// blank line ends the quote, which Markdown would otherwise carry on into the comment.
const feedbackMessage = (revision: number, comments: Comment[]) =>
  [
    `Feedback on plan revision ${revision}:`,
    ...comments.map(({ quote, text }) => `${quote.replace(/^/gm, "> ")}\n\nComment: ${text}`),
  ].join("\n\n");

// The plan as a document to review: select any part of it to comment on it. With
// comments, "Return feedback" sends them to the Lead; without, "Approve" approves this
// revision. Comments belong to this revision: a new one starts without them.
function ReviewDialog({
  plan,
  onClose,
  onApprove,
  onFeedback,
  loading,
  error,
}: {
  plan: ForgePlan;
  onClose: () => void;
  onApprove: () => void;
  onFeedback: (message: string) => void;
  loading: boolean;
  error: Error | null;
}) {
  const documentRef = useRef<HTMLDivElement>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [selection, setSelection] = useState<{ quote: string; top: number; left: number } | null>(null);
  const [draft, setDraft] = useState("");

  // A selection inside the plan opens a comment box under it.
  function select() {
    const current = window.getSelection();
    const quote = current?.toString().trim();
    if (!current || !quote || !documentRef.current?.contains(current.anchorNode)) return;
    const rect = current.getRangeAt(0).getBoundingClientRect();
    setSelection({ quote, top: rect.bottom, left: rect.left });
    setDraft("");
  }

  // A mockup is commented on as a whole, from its button.
  function commentMockup(title: string, button: HTMLElement) {
    const rect = button.getBoundingClientRect();
    setSelection({ quote: `Mockup "${title}"`, top: rect.bottom, left: rect.left });
    setDraft("");
  }

  function addComment() {
    if (!selection || !draft.trim()) return;
    setComments([...comments, { quote: selection.quote, text: draft.trim() }]);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="plan-review-title">
      <DialogTitle id="plan-review-title" sx={{ pr: 7 }}>
        Plan revision {plan.revision}
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: "absolute", right: 12, top: 12 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorMessage(error)}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select any part of the plan to comment on it, or comment on a mockup with its button.
        </Typography>
        <div ref={documentRef} onMouseUp={select}>
          <PlanView plan={plan} onCommentMockup={commentMockup} />
        </div>
        {comments.length > 0 && (
          <Stack spacing={1} sx={{ mt: 3 }}>
            <Typography variant="overline" color="text.secondary">
              Your comments
            </Typography>
            {comments.map((comment, i) => (
              <Paper key={i} variant="outlined" sx={{ p: 1.5, display: "flex", gap: 1 }}>
                <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                    “{comment.quote}”
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {comment.text}
                  </Typography>
                </Stack>
                <IconButton
                  size="small"
                  aria-label="Remove comment"
                  onClick={() => setComments(comments.filter((_, index) => index !== i))}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Stack>
        )}
        <Popover
          open={selection !== null}
          onClose={() => setSelection(null)}
          anchorReference="anchorPosition"
          anchorPosition={selection ? { top: selection.top, left: selection.left } : undefined}
        >
          <Stack spacing={1} sx={{ p: 1.5, width: 360 }}>
            <TextField
              size="small"
              multiline
              minRows={2}
              autoFocus
              placeholder="Your comment"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  addComment();
                }
              }}
            />
            <Button size="small" variant="contained" disabled={!draft.trim()} onClick={addComment} sx={{ alignSelf: "flex-end" }}>
              Comment
            </Button>
          </Stack>
        </Popover>
      </DialogContent>
      <DialogActions>
        <Button disabled={!comments.length || loading} onClick={() => onFeedback(feedbackMessage(plan.revision, comments))}>
          Return feedback
        </Button>
        <Button variant="contained" disabled={comments.length > 0 || loading} onClick={onApprove}>
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// The plan waiting for your review: opens it as a document to approve or comment on.
export default function PlanReview({
  plan,
  onApprove,
  onFeedback,
  loading,
  error,
}: {
  plan: ForgePlan;
  onApprove: (revision: number) => Promise<unknown>;
  onFeedback: (message: string) => Promise<unknown>;
  loading: boolean;
  error: Error | null;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <CardFrame title={`Plan revision ${plan.revision} is ready for your review`}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Read the design, steps and QA checklist, then approve the plan or comment on it.
        </Typography>
        <Button variant="contained" onClick={() => setOpen(true)} sx={{ alignSelf: "flex-start" }}>
          Review plan
        </Button>
      </Stack>
      {open && (
        <ReviewDialog
          key={plan.revision}
          plan={plan}
          onClose={close}
          onApprove={() => onApprove(plan.revision).then(close, () => {})}
          onFeedback={(message) => onFeedback(message).then(close, () => {})}
          loading={loading}
          error={error}
        />
      )}
    </CardFrame>
  );
}
