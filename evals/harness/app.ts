import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killTree } from "../../backend/src/processes.js";
import type { RunningApp } from "./types.js";

// Starts a test repo's app with npm run dev, PORT and DATA_FILE (for the repos that keep
// data), for a hidden check, and waits until it answers.
let nextPort = 4700;

export async function startApp(workspace: string, { dataFile }: { dataFile?: string } = {}): Promise<RunningApp> {
  const port = nextPort++;
  const url = `http://localhost:${port}`;
  const child = spawn("npm run dev", {
    cwd: workspace,
    shell: true,
    windowsHide: true,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      PORT: String(port),
      DATA_FILE: dataFile ?? join(mkdtempSync(join(tmpdir(), "eval-data-")), "todos.json"),
    },
  });
  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));
  let exited = false;
  child.on("close", () => (exited = true));
  // It couldn't start (e.g. no such folder): reported below, rather than crashing the run.
  child.on("error", (err) => {
    output += `\n${err.message}`;
    exited = true;
  });

  const stop = async () => {
    if (exited) return;
    killTree(child);
    await new Promise((resolve) => child.on("close", resolve));
  };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The app exited before it answered:\n${output.slice(-2000)}`);
    // Either loopback address: some dev servers (e.g. Vite) only listen on localhost's
    // IPv6 one, and Node's fetch only tries IPv4 for localhost.
    const answers = (base: string) => fetch(base).then((res) => res.ok, () => false);
    const ok = (await answers(`http://127.0.0.1:${port}`)) || (await answers(`http://[::1]:${port}`));
    if (ok) return { url, stop };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await stop();
  throw new Error(`The app didn't answer within 60s:\n${output.slice(-2000)}`);
}
