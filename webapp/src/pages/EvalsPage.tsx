import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { summarizeRuns, type EvalBatch, type RunMetrics } from "shared";
import { errorMessage } from "../api/client.ts";
import {
  useEvalBatches,
  useEvalRunDiff,
  useEvalScenarios,
  useEvalStatus,
  useStartEval,
  useStopEval,
} from "../api/evals.ts";
import DiffView from "../components/pipeline/DiffView.tsx";

// Runs the coordinator on test scenarios (see evals/README.md) and shows the results: start
// one, watch its output, and look at past batches, alone or compared with another.

// When a batch started, from its id (an ISO time with : and . as -).
const batchTime = (id: string) =>
  new Date(id.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/, "$1:$2:$3.$4")).toLocaleString();

function StartEval({ disabled }: { disabled: boolean }) {
  const scenarios = useEvalScenarios();
  const start = useStartEval();
  const [repo, setRepo] = useState("");
  const [scenario, setScenario] = useState("");
  const [repeat, setRepeat] = useState(1);
  const [confirming, setConfirming] = useState(false);

  const repos = [...new Set((scenarios.data ?? []).map((s) => s.repo))];
  const inRepo = (scenarios.data ?? []).filter((s) => s.repo === repo);
  const chosen = inRepo.find((s) => s.id === scenario);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Run an eval</Typography>
        {scenarios.isError && <Alert severity="error">{errorMessage(scenarios.error)}</Alert>}
        {start.isError && <Alert severity="error">{errorMessage(start.error)}</Alert>}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField
            select
            size="small"
            label="Repo"
            value={repo}
            onChange={(e) => {
              setRepo(e.target.value);
              setScenario("");
            }}
            sx={{ minWidth: 160 }}
          >
            {repos.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Scenario"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            disabled={!repo}
            sx={{ flex: 1 }}
          >
            {inRepo.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}: {s.title}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="number"
            label="Runs"
            value={repeat}
            onChange={(e) => setRepeat(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            slotProps={{ htmlInput: { min: 1, max: 10 } }}
            sx={{ width: 90 }}
          />
        </Stack>
        <Box>
          <Button variant="contained" disabled={disabled || !chosen} loading={start.isPending} onClick={() => setConfirming(true)}>
            Start
          </Button>
        </Box>
      </Stack>
      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>Start this eval?</DialogTitle>
        <DialogContent>
          <Typography>
            {repeat === 1 ? "One full pipeline run" : `${repeat} full pipeline runs`} of {chosen?.id}, in a Docker
            container. Each run spends OpenRouter credit, with the coordinator's model, and can take a while.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setConfirming(false);
              start.mutate({ scenario, repeat });
            }}
          >
            Start
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

// The eval going on (or the latest one's output), following its end.
function EvalOutput() {
  const status = useEvalStatus();
  const stop = useStopEval();
  const end = useRef<HTMLDivElement>(null);
  const output = status.data?.output ?? [];

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [output.length]);

  if (!status.data || (!status.data.running && output.length === 0)) return null;
  const { running, ended } = status.data;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h6">
            {running ? `Running ${running.scenario} (${running.repeat} run${running.repeat === 1 ? "" : "s"})` : "Latest eval"}
          </Typography>
          {running && (
            <Button color="error" loading={stop.isPending} onClick={() => stop.mutate()}>
              Stop
            </Button>
          )}
        </Stack>
        {ended && !ended.ok && <Alert severity="error">{ended.error}</Alert>}
        {ended?.ok && <Alert severity="success">Finished.</Alert>}
        <Box
          component="pre"
          sx={{ m: 0, p: 1, maxHeight: 400, overflow: "auto", fontSize: 12, bgcolor: "background.default" }}
        >
          {output.slice(-500).join("\n")}
          <div ref={end} />
        </Box>
      </Stack>
    </Paper>
  );
}

function SummaryTable({ runs, compare }: { runs: RunMetrics[]; compare?: RunMetrics[] }) {
  const rows = summarizeRuns(runs, compare);
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Metric</TableCell>
          <TableCell align="right">This batch</TableCell>
          {compare && <TableCell align="right">Baseline</TableCell>}
          {compare && <TableCell align="right">Change</TableCell>}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell>{row.label}</TableCell>
            <TableCell align="right">{row.value}</TableCell>
            {compare && <TableCell align="right">{row.was}</TableCell>}
            {compare && <TableCell align="right">{row.change ?? ""}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// One run: how it went, its hidden check, and what it changed.
function RunDetails({ batch, run }: { batch: EvalBatch; run: EvalBatch["runs"][number] }) {
  const [showDiff, setShowDiff] = useState(false);
  const diff = useEvalRunDiff(batch.scenario, batch.id, run.id, showDiff);
  const m = run.metrics;
  return (
    <Box sx={{ py: 1, borderTop: 1, borderColor: "divider" }}>
      <Typography variant="subtitle2">{run.id}</Typography>
      {!m ? (
        <Typography variant="body2" color="text.secondary">
          No results: still running, or stopped.
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          <Typography variant="body2">
            {m.rateLimited ? "Model rate limited" : m.finished ? "Finished" : "Didn't finish"} · QA {m.qaVerdict ?? "didn't report"} · {Math.round(m.seconds)}s ·{" "}
            {m.totals.toolCalls} tool calls · {Math.round(m.totals.inputTokens / 1000)}k tokens in · model {m.model}
          </Typography>
          {m.error && <Alert severity="error">{m.error}</Alert>}
          {m.check && (
            <Alert severity={m.check.passed ? "success" : "warning"} sx={{ whiteSpace: "pre-wrap" }}>
              Hidden check: {m.check.details}
            </Alert>
          )}
          <Box>
            <Button size="small" onClick={() => setShowDiff((s) => !s)}>
              {showDiff ? "Hide changes" : "Show changes"}
            </Button>
          </Box>
          <Collapse in={showDiff} unmountOnExit>
            {diff.isError && <Alert severity="error">{errorMessage(diff.error)}</Alert>}
            {diff.data !== undefined &&
              (diff.data ? <DiffView diff={diff.data} truncated={false} /> : <Typography variant="body2">No changes.</Typography>)}
          </Collapse>
        </Stack>
      )}
    </Box>
  );
}

const metricsOf = (b: EvalBatch) => b.runs.flatMap((r) => (r.metrics ? [r.metrics] : []));

// A batch at a glance: what it ran (model, code version) and how its runs went.
function batchRow(b: EvalBatch) {
  const metrics = metricsOf(b);
  const distinct = (values: (string | undefined)[]) => [...new Set(values.filter(Boolean))].join(", ") || "—";
  const checked = metrics.filter((m) => m.check);
  const errors = metrics.filter((m) => m.error && !m.rateLimited).length;
  const rateLimited = metrics.filter((m) => m.rateLimited).length;
  const noResults = b.runs.length - metrics.length;
  return {
    model: distinct(metrics.map((m) => m.model)),
    code: distinct(metrics.map((m) => m.codeVersion?.slice(0, 7))),
    check: checked.length ? `${checked.filter((m) => m.check?.passed).length}/${checked.length}` : "—",
    qa: `${metrics.filter((m) => m.qaVerdict === "pass").length}/${b.runs.length}`,
    issues: [
      errors && `${errors} error${errors === 1 ? "" : "s"}`,
      rateLimited && "rate limited",
      noResults && `${noResults} without results`,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

// Past batches of one scenario. Selecting one shows its summary and runs; a second is its
// baseline, compared with it.
function Results() {
  const batches = useEvalBatches();
  const scenarios = useEvalScenarios();
  const status = useEvalStatus();
  const [chosenScenario, setChosenScenario] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  if (batches.isError) return <Alert severity="error">{errorMessage(batches.error)}</Alert>;
  const all = batches.data ?? [];
  // Until one is chosen: the running eval's scenario, or the latest batch's.
  const scenario = chosenScenario || status.data?.running?.scenario || all[0]?.scenario || "";
  const list = all.filter((b) => b.scenario === scenario);
  const [main, other] = selected.map((id) => list.find((b) => b.id === id)).filter((b): b is EvalBatch => Boolean(b));
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Results</Typography>
        <TextField
          select
          size="small"
          label="Scenario"
          value={scenario}
          onChange={(e) => {
            setChosenScenario(e.target.value);
            setSelected([]);
          }}
        >
          {(scenarios.data ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.id}: {s.title}
            </MenuItem>
          ))}
        </TextField>
        {!batches.data ? null : list.length === 0 ? (
          <Typography color="text.secondary">No results for this scenario yet.</Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              Select a batch to see it; select a second as its baseline to compare them.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Started</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell>zini hash</TableCell>
                  <TableCell align="right">Check</TableCell>
                  <TableCell align="right">QA</TableCell>
                  <TableCell>Issues</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.map((b) => {
                  const row = batchRow(b);
                  return (
                    <TableRow key={b.id} hover onClick={() => toggle(b.id)} sx={{ cursor: "pointer" }}>
                      <TableCell padding="checkbox">
                        <Checkbox checked={selected.includes(b.id)} size="small" />
                      </TableCell>
                      <TableCell>
                        {batchTime(b.id)}
                        {other?.id === b.id && " (baseline)"}
                      </TableCell>
                      <TableCell>{row.model}</TableCell>
                      <TableCell sx={{ fontFamily: "monospace" }}>{row.code}</TableCell>
                      <TableCell align="right">{row.check}</TableCell>
                      <TableCell align="right">{row.qa}</TableCell>
                      <TableCell>{row.issues}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
        {main && (
          <Stack spacing={1}>
            <Typography variant="subtitle1">
              {batchTime(main.id)}
              {other && `, compared with the baseline from ${batchTime(other.id)}`}
            </Typography>
            <SummaryTable runs={metricsOf(main)} compare={other && metricsOf(other)} />
            {main.runs.map((run) => (
              <RunDetails key={run.id} batch={main} run={run} />
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

function EvalsPage() {
  const status = useEvalStatus();
  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h5">Evals</Typography>
        <StartEval disabled={Boolean(status.data?.running)} />
        <EvalOutput />
        <Results />
      </Stack>
    </Container>
  );
}

export default EvalsPage;
