import { outsideAgentRun } from "../forge/forge.js";
import { sendEvent } from "../core/events.js";
import { loadProjectLeadSetup, projectLeadAwaitingApproval, receiveQueuedMessages } from "./projectLead.js";
import { isRunning, onRunEnd, startRun } from "../agents/runs.js";
import { drainMessageQueue, onEnqueue } from "./messageQueue.js";
import { ProjectLeadThread } from "../models/ProjectLeadThread.js";

// Delivers queued Forge updates to Project Lead chats: when one is queued, when a
// chat's run ends (a chat that's working or waiting on an approval gets them after),
// at startup, and every POLL_MS in case a chat became ready some other way (e.g.
// connecting Linear). It drains at most once a second. It reads only the durable PL
// queue, never Forge snapshots. startRun resolves once input is saved; conversation
// message IDs make recovery before acknowledgement safe.
const POLL_MS = 30_000;
const MIN_GAP_MS = 1_000;

export function startProjectLeadMessageWorker() {
  let working = false;
  let scheduled = false;
  let lastTick = 0;
  // A drain soon: right away, or once a second has passed since the last one.
  const wake = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(
      () => {
        scheduled = false;
        void tick();
      },
      Math.max(0, lastTick + MIN_GAP_MS - Date.now()),
    ).unref();
  };
  const tick = async () => {
    // One already going drains again once it ends, for what came while it ran.
    if (working) return wake();
    working = true;
    lastTick = Date.now();
    try {
      await outsideAgentRun(() =>
        drainMessageQueue(
          async (threadId) => {
            if (isRunning(threadId)) return false;
            const setup = await loadProjectLeadSetup();
            return typeof setup !== "string" && !(await projectLeadAwaitingApproval(setup, threadId));
          },
          async (threadId, messages) => {
            if (!(await ProjectLeadThread.findByPk(threadId))) return false;
            const setup = await loadProjectLeadSetup();
            if (typeof setup === "string" || isRunning(threadId) || (await projectLeadAwaitingApproval(setup, threadId)))
              return false;
            return startRun(
              threadId,
              (signal) => receiveQueuedMessages(setup, threadId, messages, signal),
              () => sendEvent({ type: "thread.updated", threadId }),
            );
          },
        ),
      );
    } catch (error) {
      console.error("Delivering PL messages failed:", error);
    } finally {
      working = false;
    }
  };
  const stops = [onEnqueue(wake), onRunEnd((runId) => !runId.startsWith("forge:") && wake())];
  const timer = setInterval(wake, POLL_MS);
  timer.unref();
  wake();
  return () => {
    clearInterval(timer);
    for (const stop of stops) stop();
  };
}
