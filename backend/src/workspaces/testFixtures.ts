import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { storage, initDb } from "../db.js";
import "../core/developmentEnvironment.js";
import { cloneWorkspace } from "../repositories/git.js";

// Trusted host fixtures seed the same bare cache used by production clones.
export async function createTestWorkspace(issueId: string, files: Record<string, string>) {
  await initDb();
  const dir = dirname(storage),
    source = join(dir, "fixture-source"),
    bare = join(dir, "repo.git");
  const git = async (...args: string[]) =>
    promisify(execFile)("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", ...args]);
  if (!existsSync(bare)) {
    await mkdir(source, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(source, name)), { recursive: true });
      await writeFile(join(source, name), content);
    }
    await git("init", "-q", "-b", "main", source);
    await git("-C", source, "add", ".");
    await git("-C", source, "commit", "-qm", "fixture");
    await git("clone", "--bare", "-q", source, bare);
    await git("-C", bare, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
    await git("-C", bare, "fetch", "-q", "origin");
    await git("-C", bare, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  }
  await cloneWorkspace(issueId, `test/${issueId}`);
}

// Starts an app command in the workspace, waits up to timeoutSeconds for url to answer
// 2xx, then stops it: "passed", or "blocked" with why (e.g. its port is taken).
export async function probeApp(issueId: string, command: string, url: string, timeoutSeconds = 30) {
  const { ensureSandbox, workspaceRequest } = await import("./workspaceSandbox.js");
  const { readOutput, startProcess, stopProcess } = await import("../forge/qaProcesses.js");
  const target = new URL(url);
  let process: string | undefined;
  try {
    await ensureSandbox(issueId);
    await workspaceRequest(issueId, "portFree", { port: Number(target.port || (target.protocol === "https:" ? "443" : "80")) });
    process = await startProcess(issueId, command);
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (true) {
      const output = await readOutput(issueId, process);
      if (!output.startsWith(`${process}: running`)) throw new Error(output);
      const response = await workspaceRequest<string>(issueId, "http", { method: "GET", url }).catch(() => "");
      if (/^2\d\d\b/.test(response)) return `passed: ${response}`;
      if (Date.now() >= deadline) throw new Error(`Readiness timed out: ${response}\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    return `blocked: ${String(error)}`;
  } finally {
    if (process) await stopProcess(issueId, process);
  }
}
