import { useState } from "react";
import { Alert, Button, Link, Stack, TextField, Typography } from "@mui/material";
import { errorMessage } from "../../api/client.ts";
import { useOpenPullRequest, usePullRequest, useWorkspaceGitStatus } from "../../api/workspaces.ts";
import { CardFrame } from "./Cards.tsx";

// Opens a pull request for the workspace's branch, once everything is committed and
// pushed, with the title and body you write (the issue's identifier is added to the
// title). Once there's a pull request (opened here or on GitHub), a link to it instead.
function PullRequestCard({ issueId }: { issueId: string }) {
  const workspace = useWorkspaceGitStatus(issueId);
  const shipped = Boolean(workspace.data && !workspace.data.uncommitted && !workspace.data.unpushed);
  const status = usePullRequest(issueId, shipped);
  const open = useOpenPullRequest(issueId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  if (!shipped) return null;
  if (status.isError) {
    return <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(status.error)}</Alert>;
  }
  if (!status.data?.pushed) return null;

  const { pullRequest } = status.data;
  if (pullRequest) {
    return (
      <Typography variant="body2" sx={{ mt: 2 }}>
        Pull request{" "}
        <Link href={pullRequest.url} target="_blank" rel="noreferrer">
          #{pullRequest.number}
        </Link>{" "}
        ({pullRequest.state})
      </Typography>
    );
  }

  return (
    <CardFrame title="Open a pull request">
      <Stack spacing={2}>
        {open.error && <Alert severity="error">{errorMessage(open.error)}</Alert>}
        <TextField size="small" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          size="small"
          multiline
          minRows={4}
          label="Description"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            disabled={!title.trim()}
            loading={open.isPending}
            onClick={() => open.mutate({ title: title.trim(), body: body.trim() })}
          >
            Open PR
          </Button>
        </Stack>
      </Stack>
    </CardFrame>
  );
}

export default PullRequestCard;
