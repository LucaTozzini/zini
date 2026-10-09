import { WorkspaceAppRuntime } from "./workspaceAppRuntime.js";
import { workspaceWorkingDirectory } from "./workspaceFiles.js";

export const workspaceApps = new WorkspaceAppRuntime(workspaceWorkingDirectory);
process.once("exit", () => { void workspaceApps.stopAll().catch(() => {}); });
