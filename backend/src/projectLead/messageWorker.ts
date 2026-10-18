import { outsideAgentRun } from "../forge/forge.js";
import { sendEvent } from "../core/events.js";
import { loadProjectLeadSetup, projectLeadAwaitingApproval, receiveQueuedMessages } from "./projectLead.js";
import { isRunning, startRun } from "../agents/runs.js";
import { drainMessageQueue } from "./messageQueue.js";
import { ProjectLeadThread } from "../models/ProjectLeadThread.js";

// Poll only the durable PL queue, never Forge snapshots. startRun resolves once
// input is saved; conversation message IDs make recovery before acknowledgement safe.
export function startProjectLeadMessageWorker() {
  let working = false;
  const tick = async () => {
    if (working) return;
    working = true;
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
  const timer = setInterval(() => {
    void tick();
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
