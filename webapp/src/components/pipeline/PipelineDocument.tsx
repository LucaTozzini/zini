import { Alert, Skeleton, Stack, Typography } from "@mui/material";
import type { AgentRole, PipelineState } from "shared";
import { errorMessage } from "../../api/client.ts";
import { useWorkspaceDiff } from "../../api/workspaces.ts";
import DiffView from "./DiffView.tsx";
import { ChecksView, ClarificationList, PlanView, QaView, ReviewView } from "./Documents.tsx";

export default function PipelineDocument({ issueId, pipeline, role }: {
  issueId: string; pipeline: PipelineState; role: AgentRole;
}) {
  // Fetch changes only when the Code dialog is opened, not on every pipeline update.
  const diff = useWorkspaceDiff(issueId, role === "coder" && pipeline.planApproved);
  const document = role === "planner" ? pipeline.plan && <PlanView plan={pipeline.plan} /> :
    role === "coder" ? pipeline.planApproved && (diff.isPending ? <Skeleton height={120} /> :
      diff.isError ? <Alert severity="error">{errorMessage(diff.error)}</Alert> :
      diff.data?.diff ? <DiffView diff={diff.data.diff} truncated={diff.data.truncated} /> :
      <Typography color="text.secondary">No workspace changes yet.</Typography>) :
    role === "reviewer" ? <Stack spacing={2}>
      {pipeline.environmentSetup && <ChecksView setup checks={pipeline.environmentSetup} />}
      {pipeline.checks && <ChecksView checks={pipeline.checks} />}
      {pipeline.review && <ReviewView review={pipeline.review} />}
    </Stack> :
    pipeline.qa && <QaView qa={pipeline.qa} />;
  return <Stack spacing={2}>
    {pipeline.running === role && <Alert severity="info">Still working. This is the latest available output.</Alert>}
    <ClarificationList clarifications={pipeline.clarifications.filter((entry) => entry.from === role)} />
    {role === "coder" && pipeline.implementation?.commitMessage && <Typography variant="body2">
      Commit message: {pipeline.implementation.commitMessage}
    </Typography>}
    {role === "coder" && pipeline.implementation?.replanReason && <Alert severity="warning">
      Plan revision needed: {pipeline.implementation.replanReason}
    </Alert>}
    {document || <Typography color="text.secondary">No document yet.</Typography>}
  </Stack>;
}
