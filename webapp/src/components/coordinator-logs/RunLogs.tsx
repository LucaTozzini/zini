import { useEffect, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Alert,
  Box,
  ButtonBase,
  Chip,
  Collapse,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import type { RunLogEvent, RunLogSummary } from "shared";
import { errorMessage, useRunLog, useRunLogs } from "../../api.ts";
import LogEvents from "./LogEvents.tsx";
import { time } from "./time.ts";

const ROLE_TITLE = { planner: "Planner", coder: "Coder", reviewer: "Reviewer", committer: "Committer", pr_writer: "PR writer" };

// What a running run is doing, from its last line, and for how long.
function currentActivity(last: RunLogEvent | undefined, now: number) {
  if (!last) return "Starting";
  const seconds = Math.max(0, Math.round((now - new Date(last.t).getTime()) / 1000));
  if (last.event === "model_call") return `Waiting on the model, ${seconds}s`;
  if (last.event === "tool_call") return `Running ${last.name}, ${seconds}s`;
  return "Working";
}

// The time now, every second, while on.
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

// One subagent run: its role, when it started and how it ended (or what it's doing),
// then its log. Its log is fetched once it's opened; a running run starts open.
function RunSection({ issueId, run, running }: { issueId: string; run: RunLogSummary; running: boolean }) {
  const [open, setOpen] = useState(running);
  const log = useRunLog(issueId, run.id, open);
  const now = useNow(running && open);

  const status = running
    ? open
      ? currentActivity(log.data?.at(-1), now)
      : "Running"
    : run.outcome === "done"
      ? "Done"
      : run.outcome === "error"
        ? "Failed"
        : "Stopped";

  return (
    <Paper variant="outlined">
      <ButtonBase
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        sx={{ width: "100%", justifyContent: "flex-start", gap: 1, p: 2, textAlign: "left" }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {ROLE_TITLE[run.role]}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {time(run.startedAt)}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={status}
          color={running ? "info" : run.outcome === "done" ? "success" : run.outcome === "error" ? "error" : "default"}
        />
        <ExpandMoreIcon
          fontSize="small"
          color="action"
          sx={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
        />
      </ButtonBase>
      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 2 }}>
          {log.isPending ? (
            <Skeleton height={80} />
          ) : log.isError ? (
            <Alert severity="error">{errorMessage(log.error)}</Alert>
          ) : (
            <LogEvents events={log.data} />
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

// Every subagent run of the issue's pipeline, oldest first, with its log: what it was
// given, each model and tool call, and how it ended. Updated live as runs write their
// logs. pipelineRunning: whether a subagent is working now (the latest run, if it
// hasn't ended); an unended run otherwise was stopped, e.g. by a server restart.
function RunLogs({ issueId, pipelineRunning }: { issueId: string; pipelineRunning: boolean }) {
  const runs = useRunLogs(issueId);

  if (runs.isPending) return <Skeleton height={120} />;
  if (runs.isError) return <Alert severity="error">{errorMessage(runs.error)}</Alert>;
  if (runs.data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No runs yet. Each subagent run's log shows here once the pipeline starts.
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      {runs.data.map((run, i) => (
        <RunSection
          key={run.id}
          issueId={issueId}
          run={run}
          running={i === runs.data.length - 1 && run.outcome === null && pipelineRunning}
        />
      ))}
    </Stack>
  );
}

export default RunLogs;
