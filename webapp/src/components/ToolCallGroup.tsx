import { useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Box, ButtonBase, Collapse, Stack } from "@mui/material";
import type { ChatMessage } from "shared";
import ToolCallLine, { ToolCallIcon } from "./ToolCallLine.tsx";

type ToolCall = Extract<ChatMessage, { role: "tool" }>;

// Consecutive tool calls as one line, e.g. "12 tool calls · 1 failed · 2 never ran",
// expanded to list each call. Its icon is the last call's.
function ToolCallGroup({ calls, busy, results }: { calls: ToolCall[]; busy: boolean; results?: (string | undefined)[] }) {
  const [open, setOpen] = useState(false);
  const failed = calls.filter((call) => call.status === "error").length;
  const neverRan = calls.filter((call) => call.status === "never_ran").length;

  return (
    <Box sx={{ alignSelf: "flex-start", maxWidth: "85%", minWidth: 0 }}>
      <ButtonBase
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        sx={{ gap: 0.75, typography: "body2", color: "text.secondary" }}
      >
        <Box sx={{ display: "flex", flexShrink: 0, width: 14 }}>
          <ToolCallIcon call={calls.at(-1)!} busy={busy} />
        </Box>
        {calls.length} tool calls{failed ? ` · ${failed} failed` : ""}
        {neverRan ? ` · ${neverRan} never ran` : ""}
        <ExpandMoreIcon
          fontSize="small"
          sx={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
        />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={0.5} sx={{ mt: 0.5, pl: 2 }}>
          {calls.map((call, i) => (
            <ToolCallLine key={i} call={call} busy={busy} result={results?.[i]} />
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

export default ToolCallGroup;
