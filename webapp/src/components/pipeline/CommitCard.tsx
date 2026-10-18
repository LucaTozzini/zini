import { useState } from "react";
import { Alert, Button, Skeleton, Stack, TextField, Typography } from "@mui/material";
import { errorMessage } from "../../api/client.ts";
import { useCommitAndPush, useWorkspaceGitStatus } from "../../api/workspaces.ts";


// Forge commits completed coder rounds. Interrupted edits can still be
// committed with a user-entered message; the normal completed flow only pushes.
// Shown in the Forge header's git dialog, which titles it; its git status is only
// checked once the dialog opens. onDone runs once the push succeeds.
function CommitCard({ issueId, onDone }: { issueId: string; onDone?: () => void }) {
  const workspace = useWorkspaceGitStatus(issueId);

  const commit = useCommitAndPush(issueId);
  const [message, setMessage] = useState("");

  if (workspace.isPending) return <Skeleton height={60} />;
  if (workspace.isError) return <Alert severity="error" action={<Button onClick={() => workspace.refetch()}>Retry</Button>}>
    {errorMessage(workspace.error)}
  </Alert>;
  const { uncommitted = false, unpushed = false } = workspace.data ?? {};
  if (!uncommitted && !unpushed) return <Typography color="text.secondary">Nothing to commit or push.</Typography>;

  const failure = commit.error;
  return (
    <Stack spacing={2}>
        {failure && <Alert severity="error">{errorMessage(failure)}</Alert>}
        {uncommitted && (
          <TextField
            size="small"
            multiline
            minRows={3}
            label="Commit message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        )}
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={(uncommitted && !message.trim())}
            loading={commit.isPending}
            onClick={() => commit.mutate(message.trim(), { onSuccess: () => { setMessage(""); onDone?.(); } })}
          >
            {uncommitted ? "Commit & push" : "Push"}
          </Button>
        </Stack>
    </Stack>
  );
}

export default CommitCard;
