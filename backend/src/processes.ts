import { spawn, type ChildProcess } from "node:child_process";

// Commands run through the system shell (cmd.exe on Windows, sh elsewhere), the way
// the workspace setup command and the QA's commands run.

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
    // Its own process group on macOS/Linux, so killTree can stop all of it.
    detached: process.platform !== "win32",
  });
}

// Stops the shell and everything it started (e.g. npm and its children).
export function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}
