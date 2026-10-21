import { memo, useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import BlockIcon from "@mui/icons-material/Block";
import CircleTwoToneIcon from "@mui/icons-material/CircleTwoTone";
import FrontHandOutlinedIcon from "@mui/icons-material/FrontHandOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Box, ButtonBase, CircularProgress, Collapse, Typography } from "@mui/material";
import type { ChatMessage } from "shared";
import { errorMessage } from "../api/client.ts";
import { ToolResults } from "./chat/toolResults.ts";

const toolsMap: Record<string, { title: string }> = {
  get_issue: {
    title: "Get Issue",
  },
  list_issues: {
    title: "List Issues",
  },
  browser_scroll: {
    title: "Scroll",
  },
  browser_open: {
    title: "Open page",
  },
  browser_click: {
    title: "Click",
  },
};

type ToolCall = Extract<ChatMessage, { role: "tool" }>;

const valueText = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

// A tool call's status. A call without a result spins while the agent works;
// otherwise it's waiting on approval, in the card below the chat.
export function ToolCallIcon({ call, busy }: { call: ToolCall; busy: boolean }) {
  if (call.status === "done") {
    return <CircleTwoToneIcon fontSize="inherit" color="success" />;
  } else if (call.status === "error") {
    return <CircleTwoToneIcon fontSize="inherit" color="error" />;
  } else if (call.status === "never_ran") {
    return <BlockIcon fontSize="inherit" titleAccess="Never ran" sx={{ color: "text.disabled" }} />;
  } else if (busy) {
    return <CircularProgress size={12} color="inherit" />;
  }

  return <FrontHandOutlinedIcon fontSize="inherit" color="warning" titleAccess="Waiting for approval" />;
}

// A result the conversation left out, loaded when its call is opened. Results don't
// change once a call is done, so each is loaded once.
function LoadedResult({ callId, load }: { callId: string; load: (callId: string) => Promise<string> }) {
  const result = useQuery({ queryKey: ["toolResult", callId], queryFn: () => load(callId), staleTime: Infinity });
  return (
    <Typography
      component="span"
      variant="caption"
      color={result.isError ? "error" : result.isPending ? "text.secondary" : undefined}
      sx={{ display: "block", mt: 1, fontFamily: "monospace" }}
    >
      {result.isPending ? "Loading the result…" : result.isError ? errorMessage(result.error) : result.data}
    </Typography>
  );
}

// One of the agent's tool calls in the chat: its name and arguments on one line,
// expanded to show them in full (and the error, if it failed, or that it never ran).
function ToolCallLine({ call, busy }: { call: ToolCall; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const loadResult = useContext(ToolResults);
  const args = Object.entries(call.args);

  return (
    <Box
      sx={{
        alignSelf: "flex-start",
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
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
        <Box sx={{ display: "flex", flexShrink: 0, mr: 0.5 }}>
          <ToolCallIcon call={call} busy={busy} />
        </Box>
        <Box component="span" sx={{ flexShrink: 0, color: "text.primary" }}>
          {toolsMap[call.name]?.title || call.name.replaceAll("_", " ")}
        </Box>
        <Box
          component="span"
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {args.map(([, value]) => valueText(value)).join(", ")}
        </Box>
        <ExpandMoreIcon
          fontSize="small"
          sx={{
            flexShrink: 0,
            transform: open ? "none" : "rotate(-90deg)",
            transition: "transform 150ms",
          }}
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
            <Typography
              component="span"
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 1, fontFamily: "monospace" }}
            >
              Never ran
            </Typography>
          )}
          {call.error && (
            <Typography
              component="span"
              variant="caption"
              color="error"
              sx={{ display: "block", mt: 1, fontFamily: "monospace" }}
            >
              {call.error}
            </Typography>
          )}
          {call.result && call.status !== "error" && (
            <Typography component="span" variant="caption" sx={{ display: "block", mt: 1, fontFamily: "monospace" }}>
              {call.result}
            </Typography>
          )}
          {!call.result && call.status === "done" && call.callId && loadResult && (
            <LoadedResult callId={call.callId} load={loadResult} />
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

// A refetched conversation keeps its unchanged calls as the same objects, so only new
// or changed ones render again.
export default memo(ToolCallLine);
