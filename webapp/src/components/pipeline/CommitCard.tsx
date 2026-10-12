import { useState } from "react";
import { Alert, Button, Skeleton, Stack, TextField } from "@mui/material";
import { errorMessage } from "../../api/client.ts";
import { useCommitAndPush, useWorkspaceGitStatus } from "../../api/workspaces.ts";

import { CardFrame } from "./Cards.tsx";

// Forge commits completed coder rounds. Interrupted edits can still be
// committed with a user-entered message; the normal completed flow only pushes.
function CommitCard({ issueId }: { issueId: string }) {
  const workspace = useWorkspaceGitStatus(issueId);

  const commit = useCommitAndPush(issueId);
  const [message, setMessage] = useState("");

  if (workspace.isPending) return <Skeleton height={60} />;
  if (workspace.isError) return <Alert severity="error" action={<Button onClick={() => workspace.refetch()}>Retry</Button>}>
    {errorMessage(workspace.error)}
  </Alert>;
  const { uncommitted = false, unpushed = false } = workspace.data ?? {};
  if (!uncommitted && !unpushed) return null;

  const failure = commit.error;
  return (
    <CardFrame title={uncommitted ? "Commit and push the changes" : "Push the commits"}>
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
            onClick={() => commit.mutate(message.trim(), { onSuccess: () => setMessage("") })}
          >
            {uncommitted ? "Commit & push" : "Push"}
          </Button>
        </Stack>
      </Stack>
    </CardFrame>
  );
}

export default CommitCard;
