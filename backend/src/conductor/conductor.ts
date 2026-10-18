import { startRun } from "../agents/runs.js";
import { forgeThreadId, getForge, loadSetup, forgeRun, startForge } from "../forge/forge.js";
import { fetchLinearIssues, getLinearClient } from "../integrations/linear.js";
import { createWorkspace } from "../workspaces/workspaces.js";
import { isConductorEnabled, onSettingsSaved } from "../core/settings.js";
import { ConductorController } from "./controller.js";

const controller = new ConductorController(conductorIteration, (error) => console.error("conductorIteration -", error));

export function getConductorStatus() {
  return controller.getStatus();
}

async function conductorIteration(isEnabled: () => boolean) {
  // fetch linear issues with status unstarted
  const client = await getLinearClient();
  if (!client) throw new Error("No Linear client available");
  const issues = await fetchLinearIssues(client, ["unstarted"]);

  const setup = await loadSetup(); // forge setup

  // check which workspaces have not been initiated yet
  // if they are not started, create and start the forge
  for (const issue of issues) {
    try {
      if (!isEnabled()) return;
      if ((await getForge(issue.id)).started) continue; // skip forge that has already been started
      if (typeof setup === "string") throw new Error(setup); // setup returns a string on missing reqs

      await createWorkspace(client, issue.id);
      if (!isEnabled()) return;
      const run = forgeRun(setup, issue.id, "Conductor");
      const start = await startRun(forgeThreadId(issue.id), (signal) => startForge(run, "", signal), run.notify);

      if (!start) throw new Error("Conductor: Unable to run forge " + issue.id);
      console.log("Conductor: started forge for " + issue.id);
    } catch (err) {
      console.error(err);
    }
  }
}

export async function startConductor() {
  // Listen before loading the initial value so a concurrent settings save wins.
  let changed = false;
  const unsubscribe = onSettingsSaved((changes) => {
    if (changes.conductorEnabled === undefined) return;
    changed = true;
    controller.setEnabled(changes.conductorEnabled !== "false");
  });
  try {
    const enabled = await isConductorEnabled();
    if (!changed) controller.setEnabled(enabled);
  } catch (error) {
    unsubscribe();
    throw error;
  }
  return () => {
    unsubscribe();
    controller.setEnabled(false);
  };
}
