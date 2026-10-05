import { useState } from "react";
import BlockIcon from "@mui/icons-material/Block";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import FrontHandOutlinedIcon from "@mui/icons-material/FrontHandOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Box, ButtonBase, CircularProgress, Collapse, Typography } from "@mui/material";
import type { ChatMessage } from "shared";

type ToolCall = Extract<ChatMessage, { role: "tool" }>;

const valueText = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

// A tool call's status. A call without a result spins while the agent works;
// otherwise it's waiting on approval, in the card below the chat.
export function ToolCallIcon({ call, busy }: { call: ToolCall; busy: boolean }) {
  return call.status === "done" ? (
    <CheckIcon fontSize="inherit" color="success" />
  ) : call.status === "error" ? (
    <CloseIcon fontSize="inherit" color="error" />
  ) : call.status === "never_ran" ? (
    <BlockIcon fontSize="inherit" titleAccess="Never ran" sx={{ color: "text.disabled" }} />
  ) : busy ? (
    <CircularProgress size={12} color="inherit" />
  ) : (
    <FrontHandOutlinedIcon fontSize="inherit" color="warning" titleAccess="Waiting for approval" />
  );
}

// One of the agent's tool calls in the chat: its name and arguments on one line,
// expanded to show them in full (and the error, if it failed, or that it never ran).
function ToolCallLine({ call, busy, result }: { call: ToolCall; busy: boolean; result?: string }) {
  const [open, setOpen] = useState(false);
  const args = Object.entries(call.args);

  return (
    <Box sx={{ alignSelf: "flex-start", maxWidth: "85%", minWidth: 0 }}>
      <ButtonBase
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        sx={{
          gap: 0.75,
          maxWidth: "100%",
          typography: "body2",
          color: "text.secondary",
          justifyContent: "flex-start",
        }}
      >
        <Box sx={{ display: "flex", flexShrink: 0, width: 14 }}><ToolCallIcon call={call} busy={busy} /></Box>
        <Box component="span" sx={{ fontFamily: "monospace", flexShrink: 0 }}>
          {call.name}
        </Box>
        <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {args.map(([, value]) => valueText(value)).join(", ")}
        </Box>
        <ExpandMoreIcon
          fontSize="small"
          sx={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
        />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Box
          component="pre"
          sx={{
            m: 0,
            mt: 0.5,
            p: 1,
            maxHeight: 320,
            overflow: "auto",
            bgcolor: "action.hover",
            borderRadius: 1,
            typography: "caption",
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {args.map(([key, value]) => `${key}: ${valueText(value)}`).join("\n") || "No arguments"}
          {call.status === "never_ran" && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, fontFamily: "monospace" }}>
              Never ran
            </Typography>
          )}
          {call.error && (
            <Typography component="span" variant="caption" color="error" sx={{ display: "block", mt: 1, fontFamily: "monospace" }}>
              {call.error}
            </Typography>
          )}
          {result && call.status !== "error" && <Typography component="span" variant="caption"
            sx={{ display: "block", mt: 1, fontFamily: "monospace" }}>
            {result}
          </Typography>}
        </Box>
      </Collapse>
    </Box>
  );
}

export default ToolCallLine;
