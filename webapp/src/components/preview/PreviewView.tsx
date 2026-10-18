import { Alert, Container, Skeleton } from "@mui/material";
import { errorMessage } from "../../api/client.ts";
import { useWorkspaceApp } from "../../api/workspaces.ts";
import PreviewBrowser from "./PreviewBrowser.tsx";

// The issue's app, running in its workspace, in a browser there that the user controls.
function PreviewView({ issueId }: { issueId: string }) {
  const app = useWorkspaceApp(issueId);
  if (app.isPending) return <Skeleton height={120} sx={{ mx: 2 }} />;
  if (app.isError)
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Alert severity="error">{errorMessage(app.error)}</Alert>
      </Container>
    );
  if (app.data.status === "ready") return <PreviewBrowser issueId={issueId} />;
  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Alert severity={app.data.status === "failed" ? "error" : "info"}>
        {app.data.status === "starting"
          ? "The app is starting…"
          : app.data.status === "failed"
            ? `The app failed to start: ${app.data.error ?? "unknown error"}`
            : "The app isn't running. Ask the Project Lead to launch it."}
      </Alert>
    </Container>
  );
}

export default PreviewView;
