import { useState } from "react";
import { Link } from "react-router";
import {
  Alert,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Tooltip,
  Typography,
} from "@mui/material";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import CloseIcon from "@mui/icons-material/Close";
import { useThread } from "../../api/productManager.ts";
import { useLinearIssue } from "../../api/integrations.ts";
import { errorMessage } from "../../api/client.ts";

function Subscription({
  issueId,
  onClose,
}: {
  issueId: string;
  onClose: () => void;
}) {
  const issue = useLinearIssue(issueId);
  return (
    <ListItemButton
      component={Link}
      to={`/issues/${issueId}`}
      onClick={onClose}
    >
      <ListItemText
        primary={
          issue.data ? `${issue.data.identifier}: ${issue.data.title}` : issueId
        }
        secondary={
          issue.isLoading
            ? "Loading issue…"
            : issue.error
              ? "Issue details unavailable"
              : "Subscribed to coordinator updates"
        }
      />
    </ListItemButton>
  );
}

export default function PmSubscriptionsButton({
  threadId,
}: {
  threadId?: string;
}) {
  const [open, setOpen] = useState(false);
  const thread = useThread(threadId);
  const subscriptions = thread.data?.subscriptions ?? [];
  const close = () => setOpen(false);
  return (
    <>
      <Tooltip title="Coordinator subscriptions">
        <span>
          <IconButton
            size="small"
            aria-label="Coordinator subscriptions"
            disabled={!threadId}
            onClick={() => setOpen(true)}
          >
            <NotificationsActiveIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
        <DialogTitle
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          Coordinator subscriptions
          <IconButton
            size="small"
            aria-label="Close coordinator subscriptions"
            onClick={close}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {thread.isLoading ? (
            <CircularProgress size={24} />
          ) : thread.error ? (
            <Alert severity="error">{errorMessage(thread.error)}</Alert>
          ) : (
            <>
              {subscriptions.length ? (
                <List disablePadding>
                  {open &&
                    subscriptions.map((issueId) => (
                      <Subscription
                        key={issueId}
                        issueId={issueId}
                        onClose={close}
                      />
                    ))}
                </List>
              ) : (
                <Typography color="textSecondary">
                  This chat is not subscribed to any coordinators.
                </Typography>
              )}
              <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
                Ask the PM to follow or unfollow a coordinator. Subscriptions
                last until the backend restarts.
              </Typography>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
