import { useState } from "react";
import { Alert, Button, Stack, TextField } from "@mui/material";
import { errorMessage } from "../../api/client.ts";
import { useCommitAndPush, useWorkspace } from "../../api/workspaces.ts";
import { useWriteCommitMessage } from "../../api/coordinator.ts";
import { CardFrame } from "./Cards.tsx";

// Commits the workspace's changes and pushes its branch. The committer writes the
// message into the field, where you can read and edit it first. With only unpushed
// commits left (e.g. a push that failed), just a push. Nothing when all is pushed.
function CommitCard({ issueId }: { issueId: string }) {
  const workspace = useWorkspace(issueId);
  const write = useWriteCommitMessage(issueId);
  const commit = useCommitAndPush(issueId);
  const [message, setMessage] = useState("");

  const { uncommitted = false, unpushed = false } = workspace.data ?? {};
  if (!uncommitted && !unpushed) return null;

  const failure = write.error ?? commit.error;
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
          {uncommitted && (
            <Button
              disabled={commit.isPending}
              loading={write.isPending}
              onClick={() => write.mutate(undefined, { onSuccess: (data) => setMessage(data.commitMessage) })}
            >
              Write message
            </Button>
          )}
          <Button
            variant="contained"
            disabled={(uncommitted && !message.trim()) || write.isPending}
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
