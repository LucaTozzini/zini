import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { LinearIssue, StatusType } from "shared";
import { errorMessage, useLinearIssues, useLinearStatus } from "../api.ts";
import FiberManualRecordOutlinedIcon from '@mui/icons-material/FiberManualRecordOutlined';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import type { SvgIconComponent } from "@mui/icons-material";
import { Stack } from "@mui/material";

type SectionType = { type: StatusType; title: string, Icon: SvgIconComponent } 

const SECTIONS: SectionType[] = [
  { type: "unstarted", title: "Todo", Icon: FiberManualRecordOutlinedIcon },
  { type: "started", title: "In Progress", Icon: PrecisionManufacturingIcon },
];

function IssueSection({ type, title, Icon }: SectionType) {
  const issues = useLinearIssues([type]);

  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction={"row"} useFlexGap spacing={1} sx={{alignItems: "center", mb: 1}}>
      <Icon fontSize="small"/>
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
      {issues.isSuccess && <IssueList issues={issues.data} />}
    </Box>
  );
}

function IssueList({ issues }: { issues: LinearIssue[] }) {
  if (issues.length === 0)
    return <Typography color="text.secondary">No issues.</Typography>;

  return (
    <Paper variant="outlined">
      <List disablePadding>
        {issues.map((issue) => (
          <ListItemButton
            key={issue.id}
            component="a"
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            divider
          >
            <ListItemText
              primary={`${issue.identifier}  ${issue.title}`}
              secondary={`${issue.state.name} · Priority ${issue.priority} · ${issue.assignee?.name ?? "Unassigned"}`}
            />
          </ListItemButton>
        ))}
      </List>
    </Paper>
  );
}

function HomePage() {
  const { data: status } = useLinearStatus();

  if (!status?.connected || !status.valid) return;

  return SECTIONS.map((section) => (
    <IssueSection key={section.type} {...section} />
  ));
}

export default HomePage;
