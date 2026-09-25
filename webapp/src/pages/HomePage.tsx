import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { LinearIssue, StatusType } from "shared";
import { errorMessage, useLinearIssues } from "../api.ts";
import IssuePanel from "../components/IssuePanel.tsx";
import PriorityIcon from "../components/icons/PriorityIcon.tsx";
import StatusIcon from "../components/icons/StatusIcon.tsx";
import FiberManualRecordOutlinedIcon from "@mui/icons-material/FiberManualRecordOutlined";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import type { SvgIconComponent } from "@mui/icons-material";
import { Container, Stack, useMediaQuery, useTheme } from "@mui/material";

type SectionType = { type: StatusType; title: string; Icon: SvgIconComponent };

const SECTIONS: SectionType[] = [
  { type: "unstarted", title: "Todo", Icon: FiberManualRecordOutlinedIcon },
  { type: "started", title: "In Progress", Icon: PrecisionManufacturingIcon },
];

type OnSelect = (issue: LinearIssue) => void;
// What each list needs to show and change the open issue.
type Selection = { selectedId?: string; onSelect: OnSelect };

function IssueSection({
  type,
  title,
  Icon,
  selectedId,
  onSelect,
}: SectionType & Selection) {
  const issues = useLinearIssues([type]);

  return (
    <Box sx={{ mb: 4 }}>
      <Stack
        direction={"row"}
        useFlexGap
        spacing={1}
        sx={{ alignItems: "center", mb: 1 }}
      >
        <Icon fontSize="small" />
        <Typography variant="h6" component="h2">
          {title}
        </Typography>
      </Stack>
      {issues.isPending && (
        <Typography color="text.secondary">Loading…</Typography>
      )}
      {issues.isError && (
        <Alert severity="error">{errorMessage(issues.error)}</Alert>
      )}
      {issues.isSuccess && (
        <IssueList
          issues={issues.data}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </Box>
  );
}

function IssueList({
  issues,
  selectedId,
  onSelect,
}: Selection & { issues: LinearIssue[] }) {
  if (issues.length === 0)
    return <Typography color="text.secondary">No issues.</Typography>;

  return (
    <Paper variant="outlined">
      <List disablePadding>
        {issues.map((issue) => (
          <ListItemButton
            key={issue.id}
            selected={issue.id === selectedId}
            onClick={() => onSelect(issue)}
            divider
          >
            <ListItemText
              primary={`${issue.identifier}  ${issue.title}`}
              secondary={
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <PriorityIcon
                    priority={issue.priority}
                    sx={{ fontSize: 16 }}
                  />
                  <StatusIcon
                    type={issue.state.type}
                    name={issue.state.name}
                    sx={{ fontSize: 16 }}
                  />
                  <span>{issue.assignee?.name ?? "Unassigned"}</span>
                </Stack>
              }
              // The secondary line is a <p> by default, which can't hold the Stack's <div>.
              slotProps={{ secondary: { component: "div" } }}
            />
          </ListItemButton>
        ))}
      </List>
    </Paper>
  );
}

function HomePage() {
  // The issue whose panel is open, if any.
  const [selected, setSelected] = useState<LinearIssue | null>(null);
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("md"));

  // With an issue open, the panel sits beside the lists and they shrink to make room.
  return (
    <Box
      sx={{
        display: "flex",
        flex: 1,
        height: "100%",
        overflow: "hidden",
      }}
    >
      {!(isSmallScreen && selected) && (
        <Container maxWidth="md" sx={{ py: 5, overflow: "auto" }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {SECTIONS.map((section) => (
                <IssueSection
                  key={section.type}
                  {...section}
                  selectedId={selected?.id}
                  onSelect={setSelected}
                />
              ))}
            </Box>
          </Stack>
        </Container>
      )}
      {selected && (
        <IssuePanel
          key={selected.id}
          issueId={selected.id}
          onClose={() => setSelected(null)}
        />
      )}
    </Box>
  );
}

export default HomePage;
