import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  type ChipProps,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import { summarizeRuns, type EvalBatch, type EvalKind, type RunMetrics } from "shared";
import { errorMessage } from "../api/client.ts";
import { useEvalBatches, useEvalRunDiff, useEvalScenarios, useEvalStatus, useStartEval, useStopEval } from "../api/evals.ts";
import DiffView from "../components/forge/DiffView.tsx";

// Runs the forge on test scenarios, or one agent on an agent test (see evals/README.md),
// and shows the results: start one, watch its output, and look at past batches, alone or
// compared with another.

// When a batch started, from its id (an ISO time with : and . as -).
const batchTime = (id: string) =>
  new Date(id.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/, "$1:$2:$3.$4")).toLocaleString();

// "3/4" as a chip: green when all passed, red when none did, amber in between.
function RatioChip({ passed, total }: { passed: number; total: number }) {
  if (!total)
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  const color: ChipProps["color"] = passed === total ? "success" : passed === 0 ? "error" : "warning";
  return <Chip size="small" variant="outlined" color={color} label={`${passed}/${total}`} />;
}

// A button that opens the form for starting an eval: a repo, a scenario (or agent test)
// and how many runs.
function StartEval({ kind, disabled }: { kind: EvalKind; disabled: boolean }) {
  const scenarios = useEvalScenarios(kind);
  const start = useStartEval();
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState("");
  const [scenario, setScenario] = useState("");
  const [repeat, setRepeat] = useState(1);

  const repos = [...new Set((scenarios.data ?? []).map((s) => s.repo))];
  const inRepo = (scenarios.data ?? []).filter((s) => s.repo === repo);
  const chosen = inRepo.find((s) => s.id === scenario);

  return (
    <>
      <Button variant="contained" startIcon={<PlayArrowIcon />} disabled={disabled} onClick={() => setOpen(true)}>
        Start eval
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Start {kind === "agents" ? "an agent test" : "a scenario eval"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {scenarios.isError && <Alert severity="error">{errorMessage(scenarios.error)}</Alert>}
            {start.isError && <Alert severity="error">{errorMessage(start.error)}</Alert>}
            <TextField
              select
              size="small"
              label="Repo"
              value={repo}
              onChange={(e) => {
                setRepo(e.target.value);
                setScenario("");
              }}
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
              label={kind === "agents" ? "Agent test" : "Scenario"}
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              disabled={!repo}
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
              helperText={
                kind === "agents"
                  ? "Each run is one agent run from the test's starting point, in a Docker container, with the Forge's model."
                  : "Each run is a full Forge run in a Docker container, with the Forge's model, and can take a while."
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<PlayArrowIcon />}
            disabled={disabled || !chosen}
            loading={start.isPending}
            onClick={() => start.mutate({ kind, scenario, repeat }, { onSuccess: () => setOpen(false) })}
          >
            Start
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// The eval going on, or the latest one: its state, and its output, open while it runs
// and following its end.
function EvalOutput() {
  const status = useEvalStatus();
  const stop = useStopEval();
  const end = useRef<HTMLDivElement>(null);
  const output = status.data?.output ?? [];
  const running = status.data?.running;
  // Until toggled: open while running, closed once it's over.
  const [shown, setShown] = useState<boolean | null>(null);
  const open = shown ?? Boolean(running);

  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "nearest" });
  }, [output.length, open]);

  if (!status.data || (!running && output.length === 0)) return null;
  const { ended } = status.data;
  const state = running ? (
    <Chip size="small" color="primary" icon={<CircularProgress size={12} color="inherit" />} label="Running" />
  ) : ended && !ended.ok ? (
    <Chip size="small" variant="outlined" color="error" icon={<ErrorOutlineIcon />} label="Failed" />
  ) : (
    <Chip size="small" variant="outlined" color="success" icon={<CheckCircleOutlineIcon />} label="Finished" />
  );

  return (
    <Card variant="outlined">
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", px: 2, py: 1.5 }}>
        {state}
        <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {running
            ? `${running.kind === "agents" ? "Agent test " : ""}${running.scenario} · ${running.repeat} run${running.repeat === 1 ? "" : "s"}`
            : "Latest eval"}
        </Typography>
        {running && (
          <Button size="small" color="error" startIcon={<StopIcon />} loading={stop.isPending} onClick={() => stop.mutate()}>
            Stop
          </Button>
        )}
        <Button
          size="small"
          color="inherit"
          onClick={() => setShown(!open)}
          endIcon={<ExpandMoreIcon sx={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none" }} />}
        >
          {open ? "Hide output" : "Show output"}
        </Button>
      </Stack>
      {ended && !ended.ok && (
        <Alert severity="error" sx={{ mx: 2, mb: 1.5 }}>
          {ended.error}
        </Alert>
      )}
      <Collapse in={open}>
        <Box
          component="pre"
          sx={{
            m: 0,
            px: 2,
            py: 1.5,
            maxHeight: 360,
            overflow: "auto",
            fontSize: 12,
            bgcolor: "background.default",
            borderTop: 1,
            borderColor: "divider",
          }}
        >
          {output.slice(-500).join("\n")}
          <div ref={end} />
        </Box>
      </Collapse>
    </Card>
  );
}

function SummaryTable({ runs, compare }: { runs: RunMetrics[]; compare?: RunMetrics[] }) {
  const rows = summarizeRuns(runs, compare);
  return (
    <Box sx={{ overflowX: "auto" }}>
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
              <TableCell sx={{ color: "text.secondary" }}>{row.label}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {row.value}
              </TableCell>
              {compare && (
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", color: "text.secondary" }}>
                  {row.was}
                </TableCell>
              )}
              {compare && (
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {row.change ?? ""}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

// One run: how it went, its hidden check, and what it changed (agent tests change nothing).
function RunDetails({ kind, batch, run }: { kind: EvalKind; batch: EvalBatch; run: EvalBatch["runs"][number] }) {
  const [showDiff, setShowDiff] = useState(false);
  const diff = useEvalRunDiff(kind, batch.scenario, batch.id, run.id, showDiff);
  const m = run.metrics;
  return (
    <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mb: m ? 1 : 0 }}>
        <Typography variant="subtitle2" sx={{ fontFamily: "monospace", mr: 1 }}>
          {run.id}
        </Typography>
        {!m ? (
          <Typography variant="body2" color="text.secondary">
            No results: still running, or stopped.
          </Typography>
        ) : (
          <>
            {m.rateLimited ? (
              <Chip size="small" variant="outlined" color="warning" label="Rate limited" />
            ) : (
              <Chip
                size="small"
                variant="outlined"
                color={m.finished ? "success" : "error"}
                label={m.finished ? "Finished" : "Didn't finish"}
              />
            )}
            {kind === "scenarios" && (
              <Chip
                size="small"
                variant="outlined"
                color={m.qaVerdict === "pass" ? "success" : m.qaVerdict ? "error" : "default"}
                label={`QA ${m.qaVerdict ?? "didn't report"}`}
              />
            )}
            <Typography variant="body2" color="text.secondary">
              {Math.round(m.seconds)}s · {m.totals.toolCalls} tool calls · {Math.round(m.totals.inputTokens / 1000)}k tokens in ·{" "}
              {m.model}
            </Typography>
          </>
        )}
      </Stack>
      {m && (
        <Stack spacing={1}>
          {m.error && <Alert severity="error">{m.error}</Alert>}
          {m.check && (
            <Alert severity={m.check.passed ? "success" : "warning"} sx={{ whiteSpace: "pre-wrap" }}>
              Hidden check: {m.check.details}
            </Alert>
          )}
          {kind === "scenarios" && (
            <Box>
              <Button
                size="small"
                onClick={() => setShowDiff((s) => !s)}
                endIcon={
                  <ExpandMoreIcon sx={{ transition: "transform 150ms", transform: showDiff ? "rotate(180deg)" : "none" }} />
                }
              >
                {showDiff ? "Hide changes" : "Show changes"}
              </Button>
            </Box>
          )}
          <Collapse in={showDiff} unmountOnExit>
            {diff.isError && <Alert severity="error">{errorMessage(diff.error)}</Alert>}
            {diff.data !== undefined &&
              (diff.data ? (
                <DiffView diff={diff.data} truncated={false} />
              ) : (
                <Typography variant="body2">No changes.</Typography>
              ))}
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
    check: { passed: checked.filter((m) => m.check?.passed).length, total: checked.length },
    qa: { passed: metrics.filter((m) => m.qaVerdict === "pass").length, total: b.runs.length },
    issues: [
      errors && `${errors} error${errors === 1 ? "" : "s"}`,
      rateLimited && "rate limited",
      noResults && `${noResults} without results`,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

// Past batches of one scenario (or agent test). Selecting one shows its summary and runs;
// a second is its baseline, compared with it.
function Results({ kind }: { kind: EvalKind }) {
  const batches = useEvalBatches(kind);
  const scenarios = useEvalScenarios(kind);
  const status = useEvalStatus();
  const [chosenScenario, setChosenScenario] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  if (batches.isError) return <Alert severity="error">{errorMessage(batches.error)}</Alert>;
  const all = batches.data ?? [];
  // Until one is chosen: the running eval's scenario, or the latest batch's.
  const running = status.data?.running?.kind === kind ? status.data.running.scenario : "";
  const scenario = chosenScenario || running || all[0]?.scenario || "";
  const list = all.filter((b) => b.scenario === scenario);
  const [main, other] = selected.map((id) => list.find((b) => b.id === id)).filter((b): b is EvalBatch => Boolean(b));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));
  const testName = kind === "agents" ? "agent test" : "scenario";

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6">Results</Typography>
          <Typography variant="body2" color="text.secondary">
            Select a batch to see it; select a second as its baseline to compare them.
          </Typography>
        </Box>
        <TextField
          select
          size="small"
          label={kind === "agents" ? "Agent test" : "Scenario"}
          value={scenarios.data?.some((s) => s.id === scenario) ? scenario : ""}
          onChange={(e) => {
            setChosenScenario(e.target.value);
            setSelected([]);
          }}
          sx={{ width: { xs: "100%", sm: 360 } }}
        >
          {(scenarios.data ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.id}: {s.title}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {!batches.data ? null : list.length === 0 ? (
        <Card variant="outlined">
          <Typography color="text.secondary" sx={{ p: 4, textAlign: "center" }}>
            No results for this {testName} yet. Start an eval to get some.
          </Typography>
        </Card>
      ) : (
        // Capped, so a long history doesn't push the selected batch far down; the header
        // stays while it scrolls.
        <Card variant="outlined" sx={{ overflow: "auto", maxHeight: 420 }}>
          <Table size="small" stickyHeader sx={{ "& th": { whiteSpace: "nowrap" } }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Started</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>zini hash</TableCell>
                <TableCell align="center">Check</TableCell>
                {kind === "scenarios" && <TableCell align="center">QA</TableCell>}
                <TableCell>Issues</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((b) => {
                const row = batchRow(b);
                return (
                  <TableRow
                    key={b.id}
                    hover
                    selected={selected.includes(b.id)}
                    onClick={() => toggle(b.id)}
                    sx={{ cursor: "pointer", "&:last-child td": { borderBottom: 0 } }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox checked={selected.includes(b.id)} size="small" />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {batchTime(b.id)}
                      {main?.id === b.id && other && <Chip size="small" label="Batch" sx={{ ml: 1 }} />}
                      {other?.id === b.id && <Chip size="small" variant="outlined" label="Baseline" sx={{ ml: 1 }} />}
                    </TableCell>
                    <TableCell>{row.model}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace" }}>{row.code}</TableCell>
                    <TableCell align="center">
                      <RatioChip {...row.check} />
                    </TableCell>
                    {kind === "scenarios" && (
                      <TableCell align="center">
                        <RatioChip {...row.qa} />
                      </TableCell>
                    )}
                    <TableCell sx={{ color: "warning.main" }}>{row.issues}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {main && (
        <Card variant="outlined">
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", px: 2, py: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1">{batchTime(main.id)}</Typography>
              <Typography variant="body2" color="text.secondary">
                {other
                  ? `Compared with the baseline from ${batchTime(other.id)}`
                  : `${main.runs.length} run${main.runs.length === 1 ? "" : "s"}`}
              </Typography>
            </Box>
            {main.hasLog && (
              <Button
                size="small"
                component="a"
                href={`/api/evals/batches/${main.scenario}/${main.id}/log?kind=${kind}`}
                target="_blank"
                rel="noopener"
                endIcon={<OpenInNewIcon />}
              >
                Full batch log
              </Button>
            )}
          </Stack>
          <Divider />
          <SummaryTable runs={metricsOf(main)} compare={other && metricsOf(other)} />
          <Typography variant="overline" color="text.secondary" component="div" sx={{ px: 2, pt: 2 }}>
            Runs
          </Typography>
          {main.runs.map((run) => (
            <RunDetails key={run.id} kind={kind} batch={main} run={run} />
          ))}
        </Card>
      )}
    </Stack>
  );
}

function EvalsPage() {
  const status = useEvalStatus();
  const [kind, setKind] = useState<EvalKind>("scenarios");
  return (
    <Container maxWidth="md" sx={{ my: 5 }}>
      <Stack spacing={3}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h4" component="h1" gutterBottom>
              Evals
            </Typography>
            <Typography color="text.secondary">
              Run the Forge on test scenarios, or one agent on an agent test, and compare batches of runs.
            </Typography>
          </Box>
          <StartEval key={`start-${kind}`} kind={kind} disabled={Boolean(status.data?.running)} />
        </Stack>
        <Tabs value={kind} onChange={(_e, value: EvalKind) => setKind(value)} sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tab value="scenarios" label="Scenarios" />
          <Tab value="agents" label="Agent tests" />
        </Tabs>
        <EvalOutput />
        <Results key={`results-${kind}`} kind={kind} />
      </Stack>
    </Container>
  );
}

export default EvalsPage;
