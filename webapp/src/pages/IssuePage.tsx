import {
  Alert,
  Box,
  ButtonBase,
  Container,
  Dialog,
  Divider,
  IconButton,
  Typography,
} from "@mui/material";
import { useParams } from "react-router";
import { errorMessage } from "../api/client.ts";
import { useLinearIssue } from "../api/integrations.ts";
import CoordinatorView from "../components/CoordinatorView.tsx";
import LinearIcon from "../components/icons/LinearIcon.tsx";
import IssuePanel from "../components/IssuePanel.tsx";
import { useState } from "react";

const Header = ({
  title,
  identifier,
  linearUrl,
  handleShowDetails,
}: {
  title: string;
  identifier?: string;
  linearUrl?: string;
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
      {linearUrl && (
        <IconButton
          size="small"
          href={linearUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in Linear"
        >
          <LinearIcon sx={{ color: "text.primary", fontSize: 17 }} />
        </IconButton>
      )}
    </Box>
    <Divider />
  </Box>
);

function IssueDetails({ issueId }: { issueId: string }) {
  const issue = useLinearIssue(issueId);
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
        handleShowDetails={() => setShowDetails(true)}
      />
      <CoordinatorView key={issue.data.id} issueId={issue.data.id} />
      <Dialog
        open={showDetails}
        onClose={() => setShowDetails(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { "aria-label": "Issue details" } }}
      >
        {showDetails && (
          <IssuePanel
            key={issue.data.id}
            issueId={issue.data.id}
            onClose={() => setShowDetails(false)}
          />
        )}
      </Dialog>
    </Box>
  );
}

const IssuePage = () => {
  const { issueId } = useParams();
  if (!issueId) return <Alert severity="error">No issue selected.</Alert>;
  return <IssueDetails key={issueId} issueId={issueId} />;
};

export default IssuePage;
