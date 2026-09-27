import { useState, type ReactNode } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Alert, Box, ButtonBase, Collapse, Stack, Typography } from "@mui/material";
import type { RunLogEvent } from "shared";
import { time } from "./time.ts";

// A run's log as a list: the model's replies, each tool call with its result, and
// errors. model_call lines aren't listed: they only show, in the run's header, that
// it's waiting on the model.

type ToolCall = Extract<RunLogEvent, { event: "tool_call" }>;
type ToolResult = Extract<RunLogEvent, { event: "tool_result" }>;

// Long text (a prompt, a whole file), hidden until clicked.
function Details({ label, children }: { label: ReactNode; children: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <ButtonBase
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        sx={{ gap: 0.5, typography: "body2", color: "text.secondary" }}
      >
        <ExpandMoreIcon
          fontSize="small"
          sx={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
        />
        {label}
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
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}

// A timestamped line of the log.
function Line({ t, children }: { t: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, fontFamily: "monospace" }}>
        {time(t)}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>{children}</Box>
    </Stack>
  );
}

const argsText = (args: Record<string, unknown>) =>
  Object.entries(args)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(", ");

function ToolCallLine({ call, result }: { call: ToolCall; result: ToolResult | undefined }) {
  const status = !result ? "running…" : result.status === "error" ? "✗" : "✓";
  const label = (
    <>
      <b>{call.name}</b>&nbsp;{argsText(call.args)}&nbsp;{status}
    </>
  );
  return (
    <Line t={call.t}>
      {result ? (
        <Details label={label}>{result.result}</Details>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ pl: 2.5 }}>
          {label}
        </Typography>
      )}
    </Line>
  );
}

function LogEvents({ events }: { events: RunLogEvent[] }) {
  // Tool results show with their calls, paired by id.
  const results = new Map(
    events.filter((e): e is ToolResult => e.event === "tool_result").map((e) => [e.id, e]),
  );

  return (
    <Stack spacing={1}>
      {events.map((e, i) => {
        switch (e.event) {
          case "start":
            return (
              <Line key={i} t={e.t}>
                <Typography variant="body2">Started with {e.model}</Typography>
                <Details label="System prompt">{e.prompt}</Details>
                <Details label="Input">{e.input}</Details>
              </Line>
            );
          case "model_reply":
            return (
              <Line key={i} t={e.t}>
                <Typography variant="body2">
                  <b>Model</b>
                  {e.toolCalls?.length ? ` → ${e.toolCalls.map((c) => c.name).join(", ")}` : ""}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {e.finishReason && ` · ${e.finishReason}`}
                    {e.usage && ` · ${e.usage.input_tokens} in, ${e.usage.output_tokens} out`}
                  </Typography>
                </Typography>
                {e.text && (
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {e.text}
                  </Typography>
                )}
              </Line>
            );
          case "tool_call":
            return <ToolCallLine key={i} call={e} result={results.get(e.id)} />;
          case "doc_invalid":
            return (
              <Line key={i} t={e.t}>
                <Alert severity="warning">Invalid document, sent back to the model: {e.error}</Alert>
              </Line>
            );
          case "model_error":
            return (
              <Line key={i} t={e.t}>
                <Alert severity="error">Model call failed: {e.error}</Alert>
              </Line>
            );
          case "end":
            return (
              <Line key={i} t={e.t}>
                {e.outcome === "done" ? (
                  <Details label="Finished: its document">{JSON.stringify(e.document, null, 2)}</Details>
                ) : (
                  <Alert severity="error">Failed: {e.error}</Alert>
                )}
              </Line>
            );
          default:
            return null;
        }
      })}
    </Stack>
  );
}

export default LogEvents;
