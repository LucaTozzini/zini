import { Box, Typography } from "@mui/material";

// The QA's browser, live: the backend streams it as MJPEG, which an <img> shows frame by
// frame. Only rendered while the browser is open, so a new one (e.g. the QA's next
// round) mounts a new <img>, which connects again. View only.
function BrowserView({ issueId, url }: { issueId: string; url: string }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
        {url}
      </Typography>
      <Box
        component="img"
        src={`/api/coordinator/${issueId}/browser`}
        alt="The QA's browser"
        sx={{ display: "block", width: "100%", border: 1, borderColor: "divider" }}
      />
    </Box>
  );
}

export default BrowserView;
