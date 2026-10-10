import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import LanguageIcon from "@mui/icons-material/Language";
import CloseIcon from "@mui/icons-material/Close";
import { api, errorMessage } from "../../api/client.ts";

export default function ProjectLeadBrowserButton({ threadId }: { threadId?: string }) {
  const [open, setOpen] = useState(false);
  const browser = useQuery({
    queryKey: ["project-lead", "browser", threadId],
    queryFn: () =>
      api
        .get(`project-lead/threads/${threadId}/browser/status`)
        .json<{ url: string | null; sessionId: string | null }>(),
    enabled: open && Boolean(threadId),
    refetchInterval: open ? 2000 : false,
  });
  const [failedStream, setFailedStream] = useState<string | null>(null);
  const sessionId = browser.data?.sessionId;
  return (
    <>
      <Tooltip title="Project Lead browser">
        <span>
          <IconButton
            size="small"
            aria-label="Project Lead browser"
            disabled={!threadId}
            onClick={() => setOpen(true)}
          >
            <LanguageIcon />
          </IconButton>
        </span>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth={browser.data?.url ? "md" : "xs"}
        fullWidth
      >
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          Browser
          <IconButton
            size="small"
            aria-label="Close browser viewer"
            onClick={() => setOpen(false)}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {browser.isLoading ? (
            <CircularProgress size={24} />
          ) : browser.error ? (
            <Alert severity="error">{errorMessage(browser.error)}</Alert>
          ) : browser.data?.url && sessionId ? (
            <>
              <Typography
                variant="body2"
                color="textSecondary"
                sx={{ mb: 1, overflowWrap: "anywhere" }}
              >
                {browser.data.url}
              </Typography>
              {failedStream === sessionId && (
                <Alert severity="info" sx={{ mb: 1 }}>
                  The browser stream disconnected. Reopen the viewer to
                  reconnect.
                </Alert>
              )}
              {open && (
                <Box
                  component="img"
                  key={sessionId}
                  src={`/api/project-lead/threads/${threadId}/browser?session=${sessionId}`}
                  alt="The Project Lead's current browser page"
                  onLoad={() => setFailedStream(null)}
                  onError={() => setFailedStream(sessionId)}
                  sx={{
                    display: "block",
                    width: "100%",
                    borderRadius: 1,
                    borderColor: "divider",
                    borderStyle: "solid",
                    borderWidth: 1,
                  }}
                />
              )}
            </>
          ) : (
            <Typography color="textSecondary">
              The Project Lead hasn't opened its browser yet. Ask it to visit a website.
            </Typography>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
