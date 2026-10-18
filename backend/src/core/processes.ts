import { spawn, type ChildProcess } from "node:child_process";
import treeKill from "tree-kill";

// Commands run through the system shell (cmd.exe on Windows, sh elsewhere), the way
// the environment setup, checks, and QA commands run.

// Settings of zini's own that a command shouldn't inherit: an app started in a
// workspace would otherwise take zini's port, or its database.
const ZINI_ENV = ["PORT", "DB_PATH"];

export function spawnShell(command: string, cwd: string, extraEnv: Record<string, string> = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const name of ZINI_ENV) delete env[name];
  return spawn(command, {
    cwd,
    env,
    shell: true,
    windowsHide: true,
  });
}

// Stops the shell and everything it started (e.g. npm and its children).
export function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  treeKill(child.pid, "SIGKILL", () => {
    // Already gone.
  });
}
