import { useState } from "react";
import { Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import type { Decision, PendingAction } from "shared";

const PRIORITIES = ["None", "Urgent", "High", "Medium", "Low"];

// One create_issue or update_issue call, shown field by field.
function ActionDetails({ action }: { action: PendingAction }) {
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
          Priority: {PRIORITIES[priority] ?? priority}
        </Typography>
      )}
      {status && <Typography color="text.secondary">Status: {status}</Typography>}
      {assignee !== undefined && (
        <Typography color="text.secondary">Assignee: {assignee ?? "Unassigned"}</Typography>
      )}
      {description && (
        <Typography color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
          {description}
        </Typography>
      )}
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
          <Typography variant="h6">Approve changes to Linear?</Typography>
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
