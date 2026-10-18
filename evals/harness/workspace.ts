import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { LinearClient } from "@linear/sdk";
import { chromium } from "playwright";
import { storage } from "../../backend/src/db.js";
import { cloneWorkspace, git as workspaceGit, workspacePath } from "../../backend/src/repositories/git.js";
import { Workspace } from "../../backend/src/models/Workspace.js";
import { ensureSandbox, sandboxRequest } from "../../backend/src/workspaces/workspaceSandbox.js";
import { runCommandResult } from "../../backend/src/forge/qaProcesses.js";
import type { ModelConnection } from "../../backend/src/providers/modelProvider.js";
import { startApp } from "./app.js";
import type { CheckContext } from "./types.js";

// What a run in its own process (run-one.ts, run-agent.ts) shares: the model, the
// fixture repo and its workspace, the stubbed Linear issue and following the run logs.
// DB_PATH puts all of zini's data (its database, the repo's clone, the workspace, the
// run logs) in a fresh folder.

export const EVALS = resolve(import.meta.dirname, "..");
export const dataDir = dirname(resolve(storage));

export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} isn't set`);
  return value;
}

export const model = required("EVAL_MODEL");
// The backend keeps the mounted ChatGPT token current; reread it for every request.
export const connection: ModelConnection =
  process.env.EVAL_PROVIDER === "chatgpt"
    ? { provider: "chatgpt", token: async () => readFileSync(required("CHATGPT_TOKEN_FILE"), "utf8") }
    : { provider: "openrouter", key: required("OPENROUTER_API_KEY") };

// The trusted harness stays outside the repository sandbox.
if (existsSync("/.dockerenv")) {
  console.error("Run the trusted harness on the host; repository commands run in the workspace sandbox.");
  process.exit(1);
}

export const git = (args: string[], cwd?: string) =>
  execFileSync("git", ["-c", "core.autocrlf=false", "-c", "user.name=zini evals", "-c", "user.email=evals@zini.local", ...args], {
    cwd,
    encoding: "utf8",
  });

// The repo a scenario or agent test starts from, and the issue it works on.
export type Fixture = {
  // e.g. todo-app/remaining-count; its repo is the part before the slash.
  name: string;
  // Its folder, which holds its patches.
  dir: string;
  title: string;
  description: string;
  // Applied to the repo before its first commit (e.g. a planted bug).
  patch?: string;
  // Committed one by one on the issue branch: inherited work, then later rounds.
  branchPatches?: string[];
  // Advances main before work starts.
  upstreamPatch?: string;
  preinstalledDependencies?: boolean;
};

export const branchOf = (fixture: Fixture) => `eval/${fixture.name.replace("/", "-")}`;

// The test repo as a fresh git repo with one commit and the fixture's patches applied.
export function makeSourceRepo(fixture: Fixture) {
  const repoDir = join(EVALS, "repos", fixture.name.split("/")[0]!);
  const source = join(dataDir, "source");
  const skip = new Set(["node_modules", "dist", "data"]);
  cpSync(repoDir, source, {
    recursive: true,
    filter: (path) => !skip.has(path.slice(repoDir.length + 1).split(/[\\/]/)[0] ?? ""),
  });
  git(["init", "--quiet", "-b", "main"], source);
  if (fixture.patch) git(["apply", join(fixture.dir, fixture.patch)], source);
  git(["add", "-A"], source);
  git(["commit", "--quiet", "-m", "Initial commit"], source);
  if (fixture.branchPatches?.length) {
    git(["checkout", "--quiet", "-b", branchOf(fixture)], source);
    for (const [i, patch] of fixture.branchPatches.entries()) {
      git(["apply", join(fixture.dir, patch)], source);
      git(["add", "-A"], source);
      git(["commit", "--quiet", "-m", i === 0 ? "Inherited implementation" : `Round ${i + 1}`], source);
    }
    git(["checkout", "--quiet", "main"], source);
  }
  if (fixture.upstreamPatch) {
    git(["apply", join(fixture.dir, fixture.upstreamPatch)], source);
    git(["add", "-A"], source);
    git(["commit", "--quiet", "-m", "Upstream update"], source);
  }
  return source;
}

// The clone zini works from, made like cloneRepo makes one from GitHub (see git.ts):
// bare, with origin/* branches and origin/HEAD pointing at the default branch.
export function cloneLikeZini(source: string) {
  const repo = join(dataDir, "repo.git");
  git(["clone", "--bare", "--quiet", source, repo]);
  git(["-C", repo, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
  git(["-C", repo, "fetch", "--quiet", "origin"]);
  git(["-C", repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
}

// A workspace like createWorkspace makes, without Linear: its independent clone and row.
// Fixtures can omit the image's dependency install to exercise preparation.
export async function makeWorkspace(issueId: string, fixture: Fixture) {
  await cloneWorkspace(issueId, branchOf(fixture));
  await ensureSandbox(issueId);
  if (fixture.preinstalledDependencies !== false) {
    const install = await runCommandResult(issueId, "npm ci");
    if (install.exitCode !== 0) throw new Error(`Fixture dependencies failed: ${install.output}`);
  }
  await Workspace.create({
    issueId,
    context: {
      branch: branchOf(fixture),
      initialHead: (await workspaceGit(["-C", workspacePath(issueId), "rev-parse", "HEAD"])).trim(),
      targetBranch: "main",
      sourcePr: fixture.branchPatches?.length
        ? {
            number: 1,
            url: "https://github.com/evals/fixture/pull/1",
            state: "open",
            title: fixture.title,
            body: fixture.description,
          }
        : null,
    },
  });
}

// Linear, as far as the pipeline uses it: fetchLinearIssue's query, answered with the
// fixture's issue. Any other call fails, so a new one shows up instead of misleading.
export function fakeLinear(issueId: string, fixture: Fixture): LinearClient {
  const issue = {
    id: issueId,
    identifier: "EVAL-1",
    title: fixture.title,
    description: fixture.description,
    priority: 0,
    url: "",
    updatedAt: new Date().toISOString(),
    branchName: `eval/${fixture.name}`,
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    team: { key: "EVAL", name: "Evals" },
    comments: { nodes: [] },
    attachments: { nodes: [] },
    relations: { nodes: [] },
    inverseRelations: { nodes: [] },
  };
  const rawRequest = async (query: string) => {
    if (!query.includes("query Issue(")) throw new Error(`Linear call not mocked in evals:\n${query}`);
    return { data: { issue } };
  };
  return { client: { rawRequest } } as unknown as LinearClient;
}

// What a hidden check is given, for the issue's workspace.
export function checkContext(issueId: string): CheckContext {
  return {
    readFile: async (path) => sandboxRequest(await ensureSandbox(issueId), "file", { operation: "readText", path }),
    runCommand: (command) => runCommandResult(issueId, command),
    startApp: (options) => startApp(issueId, options),
    launchBrowser: async () => {
      const sandbox = await ensureSandbox(issueId);
      await sandboxRequest(sandbox, "browser");
      return chromium.connect(`ws://127.0.0.1:${sandbox.port}/browser`, { headers: { "x-workspace-token": sandbox.token } });
    },
  };
}

// Prints each run log line as it's written: who's working and what they call.
export function followLogs(logDir: string) {
  const read = new Map<string, number>();
  const short = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  };
  const poll = () => {
    if (!existsSync(logDir)) return;
    for (const file of readdirSync(logDir).sort()) {
      const role = file
        .replace(/\.jsonl$/, "")
        .split("-")
        .at(-1);
      const lines = readFileSync(join(logDir, file), "utf8").split("\n").filter(Boolean);
      for (const line of lines.slice(read.get(file) ?? 0)) {
        const event = JSON.parse(line) as { event: string; name?: string; args?: Record<string, unknown>; outcome?: string };
        if (event.event === "start") console.log(`▶ ${role}`);
        else if (event.event === "tool_call") {
          const first = Object.values(event.args ?? {})[0];
          console.log(`  ${role}: ${event.name}${first === undefined ? "" : ` ${short(first)}`}`);
        } else if (event.event === "end") console.log(`■ ${role}: ${event.outcome}`);
      }
      read.set(file, lines.length);
    }
  };
  const timer = setInterval(poll, 1500);
  return () => {
    clearInterval(timer);
    poll();
  };
}
