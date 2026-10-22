import type { WorkspaceAppState } from "shared";
import { isRunning } from "../agents/runs.js";
import { getSetting } from "../core/settings.js";
import { errorMessage } from "../core/errors.js";
import { chatModel, loadConnection } from "../providers/modelProvider.js";
import { launchWorkspaceApp } from "./workspaceApps.js";
import { workspaceApps } from "./workspaceAppSessions.js";

// Starting the workspace app from its preview page: the Project Lead's launcher (see
// workspaceApps.ts), run in the background with the Project Lead's model. Until the next
// start or stop, it keeps what the launcher said when it didn't get the app running.
const launches = new Map<string, AbortController>();
const outcomes = new Map<string, string>();

// Starts the launcher, or says why it can't. Nothing to do while the app is starting or
// running. whileForgeRuns: for restarting it after a Coder brief.
export async function startApp(issueId: string, { whileForgeRuns = false } = {}): Promise<string | null> {
  const { status } = await workspaceApps.refresh(issueId);
  if (launches.has(issueId) || status === "starting" || status === "ready") return null;
  if (!whileForgeRuns && isRunning(`forge:${issueId}`)) return "Pause the Forge to start the app";
  const [provider, model] = await Promise.all([getSetting("projectLeadProvider"), getSetting("projectLeadModel")]);
  const connection = await loadConnection(provider);
  if (typeof connection === "string") return connection;
  if (!model) return "No Project Lead model is set";

  const controller = new AbortController();
  launches.set(issueId, controller);
  outcomes.delete(issueId);
  launchWorkspaceApp(
    chatModel(connection, model),
    issueId,
    "Start the app so the user can test it in the preview.",
    controller.signal,
    { nested: false, whileForgeRuns },
  )
    .then((report) => {
      if (report.status !== "ready") outcomes.set(issueId, [report.explanation, ...report.questions].join("\n"));
    })
    .catch((error) => {
      if (!controller.signal.aborted) outcomes.set(issueId, errorMessage(error));
    })
    .finally(() => {
      if (launches.get(issueId) === controller) launches.delete(issueId);
    });
  return null;
}

// After the Coder changed the code, restarts the app if it's running or starting, so its
// preview shows the changes. In the background: the Forge carries on meanwhile.
export async function restartApp(issueId: string) {
  try {
    const { status } = await workspaceApps.refresh(issueId);
    if (!launches.has(issueId) && status !== "starting" && status !== "ready") return;
    await stopApp(issueId);
    const problem = await startApp(issueId, { whileForgeRuns: true });
    if (problem) outcomes.set(issueId, problem);
  } catch (error) {
    console.error(`Restarting the app for ${issueId} failed:`, error);
  }
}

// Stops the app, and the launcher if it's still starting it.
export async function stopApp(issueId: string) {
  launches.get(issueId)?.abort();
  launches.delete(issueId);
  outcomes.delete(issueId);
  await workspaceApps.stop(issueId);
}

// The app's state for the preview page: starting while the launcher works, and failed
// with the launcher's reason when it didn't get the app running.
export function appState({ status, error }: WorkspaceAppState, issueId: string): WorkspaceAppState {
  if (status === "stopped" && launches.has(issueId)) return { status: "starting", error: null };
  const outcome = outcomes.get(issueId);
  if (status === "stopped" && outcome) return { status: "failed", error: outcome };
  return { status, error: error ?? null };
}
