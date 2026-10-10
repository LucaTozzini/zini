import { useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from "@mui/material";
import type { PipelineState, SteeringTarget } from "shared";
import { useRedirectPipeline } from "../../api/forge.ts";
import { errorMessage } from "../../api/client.ts";

export default function SteeringControls({ issueId, pipeline, disabled }: { issueId: string; pipeline: PipelineState; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<SteeringTarget>("planner");
  const [feedback, setFeedback] = useState("");
  const redirect = useRedirectPipeline(issueId);
  const busy = redirect.isPending || Boolean(pipeline.redirecting);
  const options = pipeline.steeringOptions ?? [];
  const unavailable = options.find((option) => option.target === target)?.reason;
  return <>
    <Button variant="outlined" disabled={disabled || busy || pipeline.pausing} sx={{ pointerEvents: "auto", bgcolor: "background.default" }}
      onClick={() => { redirect.reset(); setOpen(true); setTarget(options.find((option) => !option.reason)?.target ?? "planner"); }}>
      {busy ? "Stopping before redirecting…" : "Redirect…"}
    </Button>
    <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} fullWidth maxWidth="sm">
      <DialogTitle>Redirect Forge</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <TextField select label="Start from" value={target} disabled={busy}
          onChange={(event) => setTarget(event.target.value as SteeringTarget)}>
          {options.map((option) => <MenuItem key={option.target} value={option.target} disabled={Boolean(option.reason)}>
            {option.target === "qa" ? "QA" : option.target[0].toUpperCase() + option.target.slice(1)}{option.reason && ` — ${option.reason}`}
          </MenuItem>)}
        </TextField>
        <TextField label="Feedback" required multiline minRows={4} value={feedback} disabled={busy}
          onChange={(event) => setFeedback(event.target.value)} helperText="The Forge keeps existing edits and reruns the pipeline from this stage." />
        {busy && <Alert severity="info">Stopping before redirecting…</Alert>}
        {redirect.error && <Alert severity="error">{errorMessage(redirect.error)}</Alert>}
      </Stack></DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="contained" loading={busy} disabled={disabled || busy || !feedback.trim() || Boolean(unavailable) || !options.length}
          onClick={() => redirect.mutate({ target, feedback: feedback.trim() }, { onSuccess: () => { setOpen(false); setFeedback(""); } })}>
          Redirect and run
        </Button>
      </DialogActions>
    </Dialog>
  </>;
}
