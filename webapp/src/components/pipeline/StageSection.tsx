import { useState, type ReactNode } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Box, ButtonBase, Chip, Collapse, Paper, Typography, useTheme } from "@mui/material";
import { GridLoader } from "react-spinners";

// Where a stage of the pipeline is at, shown next to its title.
export type StageStatus =
  | "waiting"
  | "working"
  | "needs_you"
  | "done"
  | "approved"
  | "changes_requested";

const STATUS: Record<StageStatus, { label: string; color: "default" | "info" | "warning" | "success" }> = {
  waiting: { label: "Waiting", color: "default" },
  working: { label: "Working…", color: "info" },
  needs_you: { label: "Needs you", color: "warning" },
  done: { label: "Done", color: "success" },
  approved: { label: "Approved", color: "success" },
  // The reviewer, while the coder fixes what it found.
  changes_requested: { label: "Changes requested", color: "warning" },
};

// One stage of the timeline (planner, coder, reviewer, finished): its title and
// status, then its document and any card waiting on you. Only the active stage starts
// open; clicking the header opens or closes any of them. Give it a key that changes
// with active, so a stage opens or closes by itself when the pipeline moves on.
function StageSection({
  title,
  status,
  active,
  children,
}: {
  title: string;
  status: StageStatus;
  active: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(active);
  const { label, color } = STATUS[status];
  const theme = useTheme();

  return (
    <Paper variant="outlined">
      <ButtonBase
        onClick={() => setOpen((o) => !o)}
        disabled={!children}
        aria-expanded={open}
        sx={{ width: "100%", justifyContent: "flex-start", gap: 1, p: 2, textAlign: "left" }}
      >
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
          {title}
        </Typography>
        {status === "working" ? 
        <Box sx={{mr: 1}}>
          <GridLoader size={4} color={(theme.vars || theme).palette.secondary.main} /> 

        </Box>
          :
        <Chip
          size="small"
          variant="outlined"
          color={color}
          label={label}
        />}
        {children && (
          <ExpandMoreIcon
            fontSize="small"
            color="action"
            sx={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
          />
        )}
      </ButtonBase>
      {children && (
        <Collapse in={open}>
          <Box sx={{ px: 2, pb: 2 }}>{children}</Box>
        </Collapse>
      )}
    </Paper>
  );
}

export default StageSection;
