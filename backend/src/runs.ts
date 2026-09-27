import type { Response } from "express";

// Agent runs (product manager chats, coordinator conversations) happen in the
// background: the request that starts one returns once its input is saved, and the
// webapp learns about progress from an event, sent whenever the conversation changes,
// after which it refetches it. What isn't in the checkpointer (whether a run is going,
// and why the last one failed) is kept here, in memory, by run id (the thread id), and
// added to the conversation's GET responses.

type RunStatus = { running: boolean; error: string | null };

const runs = new Map<string, RunStatus>();

export function runStatus(runId: string): RunStatus {
  return runs.get(runId) ?? { running: false, error: null };
}

export const isRunning = (runId: string) => runStatus(runId).running;

// Drops a deleted conversation's status.
export function forgetRun(runId: string) {
  runs.delete(runId);
}

function finishRun(runId: string, notify: () => void, err?: unknown) {
  if (err) console.error(`Agent run ${runId} failed:`, err);
  const error = err ? (err instanceof Error ? err.message : String(err)) : null;
  // The conversation may have been deleted meanwhile; don't bring its status back.
  if (runs.has(runId)) runs.set(runId, { running: false, error });
  notify();
}

// Starts a run; false if one is already going. start returns the run's stream, whose
// first chunk comes once the input is saved: this resolves then, so whoever started
// the run can refetch the conversation and find it. The rest of the run goes on in
// the background, calling notify (to send the conversation's event) after each chunk
// (a finished, saved step) and at the end; its error is kept for the GET. An error
// before the input is saved is thrown.
export async function startRun(
  runId: string,
  start: () => Promise<AsyncIterable<unknown>>,
  notify: () => void,
) {
  if (isRunning(runId)) return false;
  runs.set(runId, { running: true, error: null });

  let chunks: AsyncIterator<unknown>;
  try {
    chunks = (await start())[Symbol.asyncIterator]();
    await chunks.next();
  } catch (err) {
    finishRun(runId, notify, err);
    throw err;
  }
  notify();

  void (async () => {
    try {
      while (!(await chunks.next()).done) notify();
      finishRun(runId, notify);
    } catch (err) {
      finishRun(runId, notify, err);
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
