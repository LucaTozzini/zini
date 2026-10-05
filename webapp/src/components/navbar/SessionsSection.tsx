import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Box, Collapse, Stack, Typography } from "@mui/material";
import SessionItem from "./SessionItem";
import type { LinearIssue } from "shared";
import { useCoordinator, usePendingApprovals } from "../../api/coordinator.ts";
import PriorityIcon from "../icons/PriorityIcon.tsx";

import KeyboardArrowDownOutlinedIcon from "@mui/icons-material/KeyboardArrowDownOutlined";
import KeyboardArrowRightOutlinedIcon from "@mui/icons-material/KeyboardArrowRightOutlined";

const dimOnHoverSx = {
  transition: "opacity 400ms",
  ":hover": {
    opacity: 0.6,
  },
};

type sessionsSectionProps = {
  title: string;
  children: any;
  defaultOpen: boolean;
};
const SessionsSection = ({
  title,
  children,
  defaultOpen,
}: sessionsSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = useMemo(
    () =>
      open ? KeyboardArrowDownOutlinedIcon : KeyboardArrowRightOutlinedIcon,
    [open],
  );

  return (
    <Stack>
      <Box
        onClick={() => setOpen((i) => !i)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          cursor: "pointer",
          mb: 1,
          ...dimOnHoverSx,
        }}
      >
        <Icon fontSize="small" sx={{ color: "text.secondary" }} />

        <Typography variant="body2">{title}</Typography>
      </Box>
      <Collapse in={open} sx={{ pl: 1 }}>
        {children}
      </Collapse>
    </Stack>
  );
};

export default SessionsSection;

function IssueItem({ issue, selected, needsApproval, onClick }: {
  issue: LinearIssue;
  selected: boolean;
  needsApproval: boolean;
  onClick: () => void;
}) {
  const coordinator = useCoordinator(issue.id);
  return <SessionItem
    title={issue.title}
    updatedAt={issue.updatedAt}
    handleClick={onClick}
    selected={selected}
    needsApproval={needsApproval}
    loading={Boolean(coordinator.data?.running)}
    leadingIcon={<PriorityIcon priority={issue.priority} sx={{ fontSize: 16 }} />}
  />;
}

export const IssueItems = ({ issues }: { issues: LinearIssue[] | undefined }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const approvals = usePendingApprovals();
  const awaitingApproval = new Set(approvals.data?.map((approval) => approval.issueId));

  return (
    <>
      {!issues?.length && (
        <Typography variant="body2" color="textSecondary">
          No issues of this type
        </Typography>
      )}
      <Stack>
        {issues?.map((i) => (
          <IssueItem
            issue={i}
            onClick={() => navigate("/issues/" + i.id)}
            selected={location.pathname === "/issues/" + i.id}
            needsApproval={awaitingApproval.has(i.id)}
            key={i.id}
          />
        ))}
      </Stack>
    </>
  );
};
