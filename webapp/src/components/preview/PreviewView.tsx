import { Alert, Button, Container, Skeleton, Stack, Tooltip } from "@mui/material";
import { errorMessage } from "../../api/client.ts";
import { useForge } from "../../api/forge.ts";
import { useWorkspaceApp, useWorkspaceAppControl } from "../../api/workspaces.ts";
import PreviewBrowser from "./PreviewBrowser.tsx";

// The issue's app, running in its workspace, in a browser there that the user controls.
// Start runs the Project Lead's launcher to get it running; Stop stops it.
function PreviewView({ issueId }: { issueId: string }) {
  const app = useWorkspaceApp(issueId);
  const control = useWorkspaceAppControl(issueId);
  const forge = useForge(issueId);
  if (app.isPending) return <Skeleton height={120} sx={{ mx: 2 }} />;
  if (app.isError)
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Alert severity="error">{errorMessage(app.error)}</Alert>
      </Container>
    );
  const failure = control.error && <Alert severity="error">{errorMessage(control.error)}</Alert>;
  if (app.data.status === "ready")
    return (
      <>
        {failure}
        <PreviewBrowser
          issueId={issueId}
          actions={
            <Button size="small" loading={control.isPending} onClick={() => control.mutate("stop")} sx={{ flexShrink: 0 }}>
              Stop
            </Button>
          }
        />
      </>
    );
  const starting = app.data.status === "starting";
  // The launcher refuses while the Forge works in the workspace.
  const forgeWorking = Boolean(forge.data?.running || forge.data?.pausing);
  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={2}>
        {failure}
        <Alert severity={app.data.status === "failed" ? "error" : "info"} sx={{ whiteSpace: "pre-wrap" }}>
          {starting
            ? "The app is starting…"
            : app.data.status === "failed"
              ? `The app didn't start: ${app.data.error ?? "unknown error"}`
              : "The app isn't running."}
        </Alert>
        <Stack direction="row" spacing={1}>
          {starting ? (
            <Button loading={control.isPending} onClick={() => control.mutate("stop")}>
              Stop
            </Button>
          ) : (
            <Tooltip title={forgeWorking ? "Pause the Forge to start the app" : ""}>
              <span>
                <Button
                  variant="contained"
                  disabled={forgeWorking}
                  loading={control.isPending}
                  onClick={() => control.mutate("start")}
                >
                  Start
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
      </Stack>
    </Container>
  );
}

export default PreviewView;
