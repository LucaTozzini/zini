import type { Response } from "express";

// Agent runs (product manager chats, coordinator conversations) happen in the
// background: the request that starts one returns once its input is saved, and the
// webapp learns about progress from an event, sent whenever the conversation changes,
// after which it refetches it. What isn't in the checkpointer (whether a run is going,
// and why the last one failed) is kept here, in memory, by run id (the thread id), and
// added to the conversation's GET responses.

type RunStatus = { running: boolean; error: string | null };

const runs = new Map<string, RunStatus>();

// A conversation with no run on it, which is all the status it ever has.
const NOT_RUNNING: RunStatus = { running: false, error: null };

// Each run's own controller, so it can be stopped (see stopRun).
const controls = new Map<string, AbortController>();

export function runStatus(runId: string): RunStatus {
  return runs.get(runId) ?? NOT_RUNNING;
}

export const isRunning = (runId: string) => runStatus(runId).running;

// Drops a deleted conversation's status.
export function forgetRun(runId: string) {
  runs.delete(runId);
  controls.delete(runId);
}

// Changes a run's status, but only while it is still that run: a stop frees the run at
// once and another one takes its place, and a conversation can be deleted while its
// run goes on, which shouldn't bring its status back.
function changeRun(runId: string, status: RunStatus, change: Partial<RunStatus>) {
  if (runs.get(runId) === status) runs.set(runId, { ...status, ...change });
}

// Stops a run: false if there isn't one going. The slot is freed at once, so another
// run can start on the same conversation while this one unwinds, which takes as long
// as the model and tool calls it has in flight take to notice the abort. The stopped
// run saves nothing after the abort, so the next one carries on from its last step.
export function stopRun(runId: string): boolean {
  const control = controls.get(runId);
  if (!isRunning(runId) || !control) return false;
  control.abort();
  runs.set(runId, NOT_RUNNING);
  return true;
}

// Ends a run: its status is freed, and its conversation's event sent. A stopped run
// does neither: it was freed when it was stopped, its abort throws, which isn't a
// failure, and it changed nothing since. The status may be another run's by now, and an
// event could have the webapp refetch the conversation before that run's message is
// saved, dropping the message it already shows.
function endRun(
  runId: string,
  control: AbortController,
  status: RunStatus,
  notify: () => void,
  err?: unknown,
) {
  if (control.signal.aborted) return;
  if (err) console.error(`Agent run ${runId} failed:`, err);
  const error = err ? (err instanceof Error ? err.message : String(err)) : null;
  changeRun(runId, status, { running: false, error });
  notify();
}

// Starts a run; false if one is already going. start is handed the run's signal, which
// cancels the model and tool calls it has in flight (see stopRun), and returns the
// run's stream, whose first chunk comes once the input is saved: this resolves then, so
// whoever started the run can refetch the conversation and find it. The rest of the run
// goes on in the background, calling notify (to send the conversation's event) after
// each chunk (a finished, saved step) and at the end; its error is kept for the GET. An
// error before the input is saved is thrown.
export async function startRun(
  runId: string,
  start: (signal: AbortSignal) => Promise<AsyncIterable<unknown>>,
  notify: () => void,
) {
  if (isRunning(runId)) return false;
  const status: RunStatus = { ...NOT_RUNNING, running: true };
  const control = new AbortController();
  runs.set(runId, status);
  controls.set(runId, control);

  let chunks: AsyncIterator<unknown>;
  try {
    chunks = (await start(control.signal))[Symbol.asyncIterator]();
    await chunks.next();
  } catch (err) {
    endRun(runId, control, status, notify, err);
    throw err;
  }
  notify();

  void (async () => {
    try {
      while (!(await chunks.next()).done) if (!control.signal.aborted) notify();
      endRun(runId, control, status, notify);
    } catch (err) {
      endRun(runId, control, status, notify, err);
    }
  })();
  return true;
}

export const alreadyRunning = (res: Response) =>
  res.status(409).json({ error: "The agent is still working on this conversation" });

// startRun for a route: true once the input is saved. Otherwise sends a 409 (already
// running) or a 500 (the run failed before that) and returns false.
export async function beginRun(
  res: Response,
  runId: string,
  start: Parameters<typeof startRun>[1],
  notify: () => void,
) {
  try {
    if (await startRun(runId, start, notify)) return true;
    alreadyRunning(res);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
  return false;
}
