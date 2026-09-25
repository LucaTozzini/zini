import { sendEvent } from "./events.js";

// Product manager runs happen in the background: the request that starts one returns
// once its input is saved, and the webapp learns about progress from the thread.updated
// event, sent whenever a thread changes. It then refetches the thread. What isn't in
// the checkpointer (whether a run is going, and why the last one failed) is kept here,
// in memory, and added to the thread's GET responses.

type RunStatus = { running: boolean; error: string | null };

const runs = new Map<string, RunStatus>();

export function runStatus(threadId: string): RunStatus {
  return runs.get(threadId) ?? { running: false, error: null };
}

export const isRunning = (threadId: string) => runStatus(threadId).running;

// Drops a deleted thread's status.
export function forgetRun(threadId: string) {
  runs.delete(threadId);
}

// Tells every connected webapp that the thread changed.
export function broadcast(threadId: string) {
  sendEvent({ type: "thread.updated", threadId });
}

function finishRun(threadId: string, err?: unknown) {
  if (err) console.error(`Product manager run on ${threadId} failed:`, err);
  const error = err ? (err instanceof Error ? err.message : String(err)) : null;
  // The thread may have been deleted meanwhile; don't bring its status back.
  if (runs.has(threadId)) runs.set(threadId, { running: false, error });
  broadcast(threadId);
}

// Starts a run; false if the thread already has one going. start returns the run's
// stream, whose first chunk comes once the input is saved: this resolves then, so
// whoever started the run can refetch the thread and find it. The rest of the run goes
// on in the background, broadcasting each chunk (a finished, saved step), and its
// error is kept for the thread's GET. An error before the input is saved is thrown.
export async function startRun(threadId: string, start: () => Promise<AsyncIterable<unknown>>) {
  if (isRunning(threadId)) return false;
  runs.set(threadId, { running: true, error: null });

  let chunks: AsyncIterator<unknown>;
  try {
    chunks = (await start())[Symbol.asyncIterator]();
    await chunks.next();
  } catch (err) {
    finishRun(threadId, err);
    throw err;
  }
  broadcast(threadId);

  void (async () => {
    try {
      while (!(await chunks.next()).done) broadcast(threadId);
      finishRun(threadId);
    } catch (err) {
      finishRun(threadId, err);
    }
  })();
  return true;
}
