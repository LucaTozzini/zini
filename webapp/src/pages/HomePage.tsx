import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { LinearIssue, StatusType } from "shared";
import { errorMessage, useLinearIssues } from "../api.ts";
import IssuePanel from "../components/IssuePanel.tsx";
import PriorityIcon from "../components/icons/PriorityIcon.tsx";
import FiberManualRecordOutlinedIcon from "@mui/icons-material/FiberManualRecordOutlined";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";
import type { SvgIconComponent } from "@mui/icons-material";
import {
  Card,
  CardActionArea,
  CardContent,
  Container,
  Divider,
  Stack,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useSearchParams } from "react-router";

const ISSUE_ID = "issueId";

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
    <Stack spacing={1}>
      {issues.map((issue) => (
        <Card key={issue.id} variant="outlined">
          <CardActionArea
            onClick={() => onSelect(issue)}
            data-active={issue.id === selectedId ? "" : undefined}
            sx={{
              "&[data-active]": {
                backgroundColor: "action.selected",
              },
            }}
          >
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <PriorityIcon priority={issue.priority} sx={{ fontSize: 18 }} />
                <Typography variant="body2" sx={{ flexShrink: 0 }}>
                  {issue.identifier}
                </Typography>
                <Divider orientation="vertical" flexItem />
                <Typography noWrap>{issue.title}</Typography>
              </Box>
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
    </Stack>
  );
}

function HomePage() {
  // The issue whose panel is open, if any.
  // const [selected, setSelected] = useState<LinearIssue | null>(null);
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("md"));
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get(ISSUE_ID);

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
      {!(isSmallScreen && selectedId) && (
        <Container maxWidth="md" sx={{ py: 5, overflow: "auto" }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {SECTIONS.map((section) => (
                <IssueSection
                  key={section.type}
                  {...section}
                  selectedId={selectedId ?? undefined}
                  onSelect={(issue) => {
                    if (issue.id !== selectedId) {
                      setSearchParams((params) => {
                        params.set(ISSUE_ID, issue.id);
                        return params;
                      });
                    }
                  }}
                />
              ))}
            </Box>
          </Stack>
        </Container>
      )}
      {selectedId && (
        <IssuePanel
          key={selectedId}
          issueId={selectedId}
          onClose={() =>
            setSearchParams((params) => {
              params.delete(ISSUE_ID);
              return params;
            })
          }
        />
      )}
    </Box>
  );
}

export default HomePage;
