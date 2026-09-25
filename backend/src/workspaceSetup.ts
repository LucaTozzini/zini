import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { SetupStatus } from "shared";
import { storage } from "./db.js";
import { sendEvent } from "./events.js";
import { workspacePath } from "./git.js";
import { Workspace } from "./models/Workspace.js";
import { getSetting } from "./settings.js";

// Each new workspace runs the workspaceSetupCommand setting (e.g. "npm ci") so it's
// ready to work in. It runs in the background through the system shell (cmd.exe on
// Windows, sh elsewhere), in the workspace folder. Its status is on the workspace's
// row; its output goes to a log file here, outside the workspace so git doesn't see it.
const LOG_DIR = resolve(dirname(storage), "workspace-logs");
const DEFAULT_TIMEOUT_MINUTES = 15;
// The most of a log the webapp is sent: its end, where a failure shows.
const MAX_LOG_BYTES = 1024 * 1024;

const logPath = (issueId: string) => join(LOG_DIR, `${issueId}.log`);

// Setups running now, so they can be stopped on timeout.
const running = new Map<string, ChildProcess>();

export const isSettingUp = (issueId: string) => running.has(issueId);

async function setStatus(issueId: string, setupStatus: SetupStatus, setupError: string | null) {
  await Workspace.update({ setupStatus, setupError }, { where: { issueId } });
  sendEvent({ type: "workspace.updated", issueId });
}

// Stops the shell and everything it started (e.g. npm and its children).
function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    process.kill(-child.pid, "SIGKILL");
  }
}

// Runs the setup command in the issue's workspace. Resolves once it has started (or
// straight away as ready, with no command set); the outcome is saved on the row.
export async function startSetup(issueId: string) {
  const [command, timeoutSetting] = await Promise.all([
    getSetting("workspaceSetupCommand"),
    getSetting("workspaceSetupTimeoutMinutes"),
  ]);
  if (!command) return setStatus(issueId, "ready", null);
  const minutes = Number(timeoutSetting) || DEFAULT_TIMEOUT_MINUTES;

  await mkdir(LOG_DIR, { recursive: true });
  const log = createWriteStream(logPath(issueId));
  log.write(`$ ${command}\n`);
  await setStatus(issueId, "running", null);

  const child = spawn(command, {
    cwd: workspacePath(issueId),
    shell: true,
    windowsHide: true,
    // Its own process group on macOS/Linux, so a timeout can stop all of it.
    detached: process.platform !== "win32",
  });
  running.set(issueId, child);
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, minutes * 60_000);

  // "error" (it couldn't start) and "close" can both fire; only the first counts.
  let finished = false;
  const finish = (error: string | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    running.delete(issueId);
    log.end(`\n${error ?? "Setup finished"}\n`);
    setStatus(issueId, error ? "failed" : "ready", error).catch((err) =>
      console.error(`Saving the setup status of ${issueId} failed:`, err),
    );
  };
  child.on("error", (err) => finish(`Couldn't run the setup command: ${err.message}`));
  child.on("close", (code, signal) => {
    if (timedOut) finish(`Timed out after ${minutes} minute${minutes === 1 ? "" : "s"}`);
    else if (code === 0) finish(null);
    else finish(code === null ? `Stopped by ${signal}` : `Exited with code ${code}`);
  });
}

// The end of the issue's setup log, or "" if there isn't one.
export async function readSetupLog(issueId: string) {
  if (!existsSync(logPath(issueId))) return "";
  const file = await open(logPath(issueId));
  try {
    const { size } = await file.stat();
    const length = Math.min(size, MAX_LOG_BYTES);
    const { buffer } = await file.read(Buffer.alloc(length), 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    await file.close();
  }
}

export async function deleteSetupLog(issueId: string) {
  await rm(logPath(issueId), { force: true });
}

// A restart ends any setup that was running; say so rather than leave it "running".
export async function failInterruptedSetups() {
  await Workspace.update(
    { setupStatus: "failed", setupError: "Interrupted by a server restart" },
    { where: { setupStatus: "running" } },
  );
}
