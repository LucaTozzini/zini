import { useState } from "react";
import ChecklistIcon from "@mui/icons-material/Checklist";
import CloseIcon from "@mui/icons-material/Close";
import DifferenceOutlinedIcon from "@mui/icons-material/DifferenceOutlined";
import { Alert, Dialog, DialogContent, DialogTitle, IconButton, Skeleton, Tooltip, Typography } from "@mui/material";
import { errorMessage } from "../../api/client.ts";
import { useForge } from "../../api/forge.ts";
import { useWorkspaceDiff } from "../../api/workspaces.ts";
import DiffView from "./DiffView.tsx";
import { PlanView } from "./Documents.tsx";

// The workspace's changes, fetched only while shown.
function Changes({ issueId }: { issueId: string }) {
  const diff = useWorkspaceDiff(issueId, true);
  if (diff.isPending) return <Skeleton height={120} />;
  if (diff.isError) return <Alert severity="error">{errorMessage(diff.error)}</Alert>;
  return diff.data?.diff ? <DiffView diff={diff.data.diff} truncated={diff.data.truncated} />
    : <Typography color="text.secondary">No workspace changes yet.</Typography>;
}

// The Forge's plan and code changes, as header buttons that open them in a dialog.
export default function ForgeDocuments({ issueId }: { issueId: string }) {
  const forge = useForge(issueId);
  const [open, setOpen] = useState<"plan" | "changes" | null>(null);
  const plan = forge.data?.plan ?? null;
  const title = open === "plan"
    ? `Plan${forge.data?.planApproved ? "" : " (not approved yet)"}${forge.data?.finished ? " · finished" : ""}`
    : "Code changes";
  return <>
    <Tooltip title={plan ? "Plan" : "No plan yet"}>
      <span><IconButton size="small" aria-label="Plan" disabled={!plan} onClick={() => setOpen("plan")}>
        <ChecklistIcon sx={{ fontSize: 19 }} />
      </IconButton></span>
    </Tooltip>
    <Tooltip title={forge.data?.started ? "Code changes" : "The Forge hasn't started"}>
      <span><IconButton size="small" aria-label="Code changes" disabled={!forge.data?.started} onClick={() => setOpen("changes")}>
        <DifferenceOutlinedIcon sx={{ fontSize: 19 }} />
      </IconButton></span>
    </Tooltip>
    <Dialog open={open !== null} onClose={() => setOpen(null)} fullWidth maxWidth={open === "changes" ? "lg" : "md"}
      aria-labelledby="forge-document-title">
      <DialogTitle id="forge-document-title" sx={{ pr: 7 }}>
        {title}
        <IconButton aria-label="Close" onClick={() => setOpen(null)} sx={{ position: "absolute", right: 12, top: 12 }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {open === "plan" && plan && <PlanView plan={plan} />}
        {open === "changes" && <Changes issueId={issueId} />}
      </DialogContent>
    </Dialog>
  </>;
}
