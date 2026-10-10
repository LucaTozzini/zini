import { getPipeline, outsideAgentRun } from "../forge/forge.js";
import { forgeSnapshot, forgeSubscriptions, type ForgeSnapshot } from "../forge/forgeSubscriptions.js";
import { onServerEvent, sendEvent } from "../core/events.js";
import { ProjectLeadThread } from "../models/ProjectLeadThread.js";
import { Workspace } from "../models/Workspace.js";
import { loadProjectLeadSetup, projectLeadAwaitingApproval, receiveForgeUpdates } from "./projectLead.js";
import { isRunning, startRun } from "../agents/runs.js";

async function snapshot(issueId: string): Promise<ForgeSnapshot | null> {
  const workspace = await Workspace.findByPk(issueId);
  if (!workspace) return null;
  const pipeline = await getPipeline(issueId);
  return forgeSnapshot(pipeline);
}

// Polling also drains updates after a Project Lead turn finishes, independent of open browsers.
// Events prompt a check immediately; noisy token/tool/file updates share a fingerprint.
export function startProjectLeadForgeUpdates() {
  const tick = () => outsideAgentRun(() => forgeSubscriptions.tick(snapshot, async (threadId, events) => {
    if (isRunning(threadId)) return false;
    if (!(await ProjectLeadThread.findByPk(threadId))) {
      forgeSubscriptions.forget(threadId);
      return true;
    }
    const setup = await loadProjectLeadSetup();
    if (typeof setup === "string" || await projectLeadAwaitingApproval(setup, threadId)) return false;
    return startRun(threadId, (signal) => receiveForgeUpdates(setup, threadId, events, signal),
      () => sendEvent({ type: "thread.updated", threadId }));
  })).catch((error: unknown) => { console.error("Delivering Forge updates failed:", error); });
  const timer = setInterval(() => { void tick(); }, 1000);
  timer.unref();
  const unsubscribe = onServerEvent((event) => {
    if (event.type === "forge.updated" || event.type === "workspace.updated") void tick();
  });
  return () => { clearInterval(timer); unsubscribe(); };
}
