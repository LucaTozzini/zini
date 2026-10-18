import { Alert, Box, ButtonBase, Container, Dialog, Divider, IconButton, Tooltip, Typography } from "@mui/material";
import ConstructionOutlinedIcon from "@mui/icons-material/ConstructionOutlined";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import PreviewView from "../components/preview/PreviewView.tsx";
import { Link as RouterLink, useParams } from "react-router";
import { useWorkspace } from "../api/workspaces.ts";
import { errorMessage } from "../api/client.ts";
import { useLinearIssue } from "../api/integrations.ts";
import ForgeView from "../components/ForgeView.tsx";
import ForgeDocuments from "../components/forge/ForgeDocuments.tsx";
import { isActiveBlocker } from "shared";
import LinearIcon from "../components/icons/LinearIcon.tsx";
import IssuePanel from "../components/IssuePanel.tsx";
import { useState, type ReactNode } from "react";

const Header = ({
  title,
  identifier,
  linearUrl,
  link,
  actions,
  handleShowDetails,
}: {
  title: string;
  identifier?: string;
  linearUrl?: string;
  // The issue's other view: its Forge, or its app's preview.
  link?: { to: string; label: string; icon: ReactNode };
  // Extra buttons, before the link.
  actions?: ReactNode;
  handleShowDetails?: () => void;
}) => (
  <Box
    sx={{
      position: "sticky",
      top: 0,
      zIndex: 1000,
      flexShrink: 0,
      bgcolor: "background.default",
    }}
  >
    <Box
      sx={{
        p: 1,
        px: 2.5,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <ButtonBase
        onClick={handleShowDetails}
        disabled={!handleShowDetails}
        aria-haspopup={handleShowDetails ? "dialog" : undefined}
        sx={{
          textAlign: "left",
          my: 0.5,
          borderRadius: 0.5,
          maxWidth: "80%",
          ":hover": { opacity: 0.7 },
        }}
      >
        <Typography variant="body2" noWrap>
          {!!identifier && (
            <Box component={"span"} sx={{ color: "text.secondary", mr: 1 }}>
              {identifier}
            </Box>
          )}
          {title}
        </Typography>
      </ButtonBase>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        {actions}
        {link && (
          <Tooltip title={link.label}>
            <IconButton size="small" component={RouterLink} to={link.to} aria-label={link.label}>
              {link.icon}
            </IconButton>
          </Tooltip>
        )}
        {linearUrl && (
          <IconButton size="small" href={linearUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in Linear">
            <LinearIcon sx={{ color: "text.primary", fontSize: 17 }} />
          </IconButton>
        )}
      </Box>
    </Box>
    <Divider />
  </Box>
);

// The issue's page: its Forge, or (view "preview") its workspace app's preview.
function IssueDetails({ issueId, view }: { issueId: string; view: "forge" | "preview" }) {
  const issue = useLinearIssue(issueId);
  // The URL can name the issue by its identifier; the workspace is keyed by its id.
  const workspace = useWorkspace(issue.data?.id);
  const [showDetails, setShowDetails] = useState(false);

  if (issue.isPending) return <Header title="Loading..." />;

  if (issue.isError) {
    return (
      <>
        <Header title="Couldn't load issue" />
        <Container maxWidth="md" sx={{ py: 3 }}>
          <Alert severity="error">{errorMessage(issue.error)}</Alert>
        </Container>
      </>
    );
  }

  return (
    <Box sx={{ height: "100%", minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Header
        identifier={issue.data.identifier}
        title={issue.data.title}
        linearUrl={issue.data.url}
        link={
          view === "preview"
            ? {
                to: `/issues/${issue.data.id}`,
                label: "Open the Forge",
                icon: <ConstructionOutlinedIcon sx={{ fontSize: 19 }} />,
              }
            : workspace.data
              ? {
                  to: `/issues/${issue.data.id}/preview`,
                  label: "Open the app's preview",
                  icon: <OpenInBrowserIcon sx={{ fontSize: 19 }} />,
                }
              : undefined
        }
        actions={view === "forge" && <ForgeDocuments issueId={issue.data.id} />}
        handleShowDetails={() => setShowDetails(true)}
      />
      {view === "forge" && issue.data.blockedBy.some(isActiveBlocker) && (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          Blocked by{" "}
          {issue.data.blockedBy
            .filter(isActiveBlocker)
            .map((blocker) => `${blocker.identifier} ${blocker.title} (${blocker.state.name})`)
            .join(", ")}
        </Alert>
      )}
      {view === "preview" ? (
        <PreviewView key={issue.data.id} issueId={issue.data.id} />
      ) : (
        <ForgeView key={issue.data.id} issueId={issue.data.id} />
      )}
      <Dialog
        open={showDetails}
        onClose={() => setShowDetails(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { "aria-label": "Issue details" } }}
      >
        {showDetails && <IssuePanel key={issue.data.id} issueId={issue.data.id} onClose={() => setShowDetails(false)} />}
      </Dialog>
    </Box>
  );
}

const IssuePage = ({ view = "forge" }: { view?: "forge" | "preview" }) => {
  const { issueId } = useParams();
  if (!issueId) return <Alert severity="error">No issue selected.</Alert>;
  return <IssueDetails key={issueId} issueId={issueId} view={view} />;
};

export default IssuePage;
