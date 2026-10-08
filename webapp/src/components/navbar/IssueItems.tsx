import type { LinearIssue } from "shared";
import { ListItem, ListItemText } from "@mui/material";
import { useLocation } from "react-router";
import { useCoordinator, usePendingApprovals } from "../../api/coordinator.ts";
import PriorityIcon from "../icons/PriorityIcon.tsx";
import SessionItem from "./SessionItem.tsx";

function IssueItem({ issue, needsApproval }: { issue: LinearIssue; needsApproval: boolean }) {
  const coordinator = useCoordinator(issue.id);
  const location = useLocation();
  const itemId = `/issues/${issue.id}`;
  return <SessionItem itemId={itemId} title={issue.title} updatedAt={issue.updatedAt}
    selected={location.pathname === itemId} needsApproval={needsApproval}
    loading={Boolean(coordinator.data?.running)}
    leadingIcon={<PriorityIcon priority={issue.priority} sx={{ fontSize: 12 }} />} />;
}

export default function IssueItems({ issues }: { issues: LinearIssue[] | undefined }) {
  const approvals = usePendingApprovals();
  const awaitingApproval = new Set(approvals.data?.map((approval) => approval.issueId));
  if (!issues?.length) return <ListItem sx={{ px: 1, py: 0.25 }}><ListItemText primary={issues ? "No issues of this type" : "Loading..."}
    slotProps={{ primary: { variant: "body2", color: "textSecondary" } }} /></ListItem>;
  return <>{issues.map((issue) => <IssueItem key={issue.id} issue={issue} needsApproval={awaitingApproval.has(issue.id)} />)}</>;
}
