import { getPipeline, outsideAgentRun } from "./coordinator.js";
import { coordinatorSnapshot, coordinatorSubscriptions, type CoordinatorSnapshot } from "./coordinatorSubscriptions.js";
import { onServerEvent, sendEvent } from "./events.js";
import { PmThread } from "./models/PmThread.js";
import { Workspace } from "./models/Workspace.js";
import { loadPmSetup, pmAwaitingApproval, receiveCoordinatorUpdates } from "./productManager.js";
import { isRunning, startRun } from "./runs.js";

async function snapshot(issueId: string): Promise<CoordinatorSnapshot | null> {
  const workspace = await Workspace.findByPk(issueId);
  if (!workspace) return null;
  const pipeline = await getPipeline(issueId);
  return coordinatorSnapshot(pipeline);
}

// Polling also drains updates after a PM turn finishes, independent of open browsers.
// Events prompt a check immediately; noisy token/tool/file updates share a fingerprint.
export function startPmCoordinatorUpdates() {
  const tick = () => outsideAgentRun(() => coordinatorSubscriptions.tick(snapshot, async (threadId, events) => {
    if (isRunning(threadId)) return false;
    if (!(await PmThread.findByPk(threadId))) {
      coordinatorSubscriptions.forget(threadId);
      return true;
    }
    const setup = await loadPmSetup();
    if (typeof setup === "string" || await pmAwaitingApproval(setup, threadId)) return false;
    return startRun(threadId, (signal) => receiveCoordinatorUpdates(setup, threadId, events, signal),
      () => sendEvent({ type: "thread.updated", threadId }));
  })).catch((error: unknown) => { console.error("Delivering coordinator updates failed:", error); });
  const timer = setInterval(() => { void tick(); }, 1000);
  timer.unref();
  const unsubscribe = onServerEvent((event) => {
    if (event.type === "coordinator.updated" || event.type === "workspace.updated") void tick();
  });
  return () => { clearInterval(timer); unsubscribe(); };
}
