import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { storage } from "../db.js";
import { sendEvent } from "../core/events.js";
import { getSetting } from "../core/settings.js";
import { createPullRequest, findPullRequest } from "../integrations/github.js";
import { getKey } from "../models/Integration.js";
import { REPO_DIR, defaultBranch, fetchRepo, git } from "../repositories/git.js";
import { DEFAULT_OPENWIKIIGNORE } from "./ignoreDefaults.js";

// The docs branch the wiki update is pushed to.
const DOCS_BRANCH = "docs/openwiki-update";
// Cap for the CLI's captured output; failures report only the tail.
const MAX_LOG_CHARS = 200_000;
const ERROR_TAIL_CHARS = 4000;

const GEN_DIR = resolve(dirname(storage), "openwiki-gen");
const CONFIG_DIR = resolve(dirname(storage), "openwiki-config");

export type ScanState = "idle" | "running" | "failed" | "done";

export type ScanStatus = {
  state: ScanState;
  startedAt: string | null;
  error: string | null;
  ignoreUsed: "repo" | "default" | null;
  branch: string | null;
  pullRequestUrl: string | null;
};

// One scan at a time: generation is expensive and two runs would fight over the worktree.
let running = false;
let status: ScanStatus = {
  state: "idle",
  startedAt: null,
  error: null,
  ignoreUsed: null,
  branch: null,
  pullRequestUrl: null,
};

export function getScanStatus(): ScanStatus {
  return { ...status };
}

const tail = (s: string) => (s.length > ERROR_TAIL_CHARS ? `...${s.slice(-ERROR_TAIL_CHARS)}` : s);

// Forgets the worktree registration and deletes its directory. Never throws.
async function removeWorktree() {
  await git(["-C", REPO_DIR, "worktree", "remove", "--force", GEN_DIR]).catch(() => {});
  await rm(GEN_DIR, { recursive: true, force: true }).catch(() => {});
  await git(["-C", REPO_DIR, "worktree", "prune"]).catch(() => {});
}

// A fresh detached worktree at origin/HEAD, with an ignore file in place. Returns
// which ignore the run uses: the repo's own, or zini's default (written here, never committed).
async function prepareWorktree(): Promise<"repo" | "default"> {
  await removeWorktree();
  await git(["-C", REPO_DIR, "worktree", "add", "--detach", GEN_DIR, "origin/HEAD"]);
  const existing = await readFile(join(GEN_DIR, ".openwikiignore"), "utf8").catch(() => "");
  if (existing.trim()) return "repo";
  await writeFile(join(GEN_DIR, ".openwikiignore"), DEFAULT_OPENWIKIIGNORE);
  return "default";
}

function openwikiBin() {
  // <repo-root>/node_modules/.bin/openwiki: npm workspaces hoist dependencies to
  // the root. Three levels up works from both src/ and dist/.
  return join(dirname(fileURLToPath(import.meta.url)), "../../../node_modules/.bin/openwiki");
}

// Starts a scan if none is running. Returns once the CLI is spawned; the rest of the
// flow continues in the background and reports through getScanStatus() and events.
export async function startScan(): Promise<{ started: boolean; error?: string }> {
  if (running) return { started: false, error: "A documentation scan is already running" };
  running = true;
  const notStarted = (error: string) => {
    running = false;
    return { started: false, error };
  };
  try {
    const [repo, githubToken, openrouterKey, model] = await Promise.all([
      getSetting("githubRepo"),
      getKey("github"),
      getKey("openrouter"),
      getSetting("openwikiModel"),
    ]);
    if (!repo) return notStarted("Set a GitHub repository first");
    if (!githubToken) return notStarted("GitHub isn't connected");
    if (!openrouterKey) return notStarted("OpenRouter isn't connected");
    if (!model) return notStarted("Set an OpenWiki model in settings first");
    if (!existsSync(openwikiBin())) return notStarted("The openwiki package isn't installed yet");

    status = {
      state: "running",
      startedAt: new Date().toISOString(),
      error: null,
      ignoreUsed: null,
      branch: null,
      pullRequestUrl: null,
    };
    sendEvent({ type: "openwiki.updated" });

    await fetchRepo();
    status.ignoreUsed = await prepareWorktree();
    sendEvent({ type: "openwiki.updated" });

    spawnCli({ repo, githubToken, openrouterKey, model });
    return { started: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    status = { ...status, state: "failed", error };
    running = false;
    sendEvent({ type: "openwiki.updated" });
    await removeWorktree();
    return { started: false, error };
  }
}

type ScanContext = { repo: string; githubToken: string; openrouterKey: string; model: string };

// Runs the CLI without awaiting it; the exit handler finishes the scan.
function spawnCli(ctx: ScanContext) {
  let log = "";
  const append = (data: Buffer) => {
    log += data.toString();
    if (log.length > MAX_LOG_CHARS) log = log.slice(-MAX_LOG_CHARS);
  };
  const child = spawn(openwikiBin(), ["--init"], {
    cwd: GEN_DIR,
    env: {
      ...process.env,
      OPENWIKI_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: ctx.openrouterKey,
      OPENWIKI_MODEL_ID: ctx.model,
      OPENWIKI_CONFIG_DIR: CONFIG_DIR,
      OPENWIKI_TELEMETRY_DISABLED: "1",
      // Without a cap, OpenRouter's credit pre-check budgets for the model's full
      // output ceiling and every request can fail with a 402 on a low balance.
      OPENWIKI_OPENROUTER_MAX_TOKENS: "8192",
    },
  });
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  let settled = false;
  const finish = (err: Error | null) => {
    if (settled) return;
    settled = true;
    void finishScan(err, ctx).catch((e) => console.error("openwiki finish failed:", e));
  };
  child.on("error", finish);
  child.on("exit", (code, signal) =>
    finish(code === 0 ? null : new Error(`openwiki --init exited with ${code ?? signal}: ${tail(log)}`)),
  );
}

// Verifies, commits, pushes, and opens the PR after a successful CLI run. Always
// removes the worktree and releases the mutex, whatever happens.
async function finishScan(spawnError: Error | null, ctx: ScanContext) {
  try {
    if (spawnError) throw spawnError;
    const pullRequestUrl = await verifyAndPublish(ctx);
    status = { ...status, state: "done", error: null, pullRequestUrl };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    status = { ...status, state: "failed", error };
    console.error(`openwiki scan failed: ${error}`);
  } finally {
    await removeWorktree();
    running = false;
    sendEvent({ type: "openwiki.updated" });
  }
}

// The agent may only have touched openwiki/ (plus our untracked ignore file).
// Commits the wiki, pushes it, and opens (or reuses) the docs PR. Returns the PR
// URL, or null when the wiki is unchanged and there is nothing to publish.
async function verifyAndPublish(ctx: ScanContext): Promise<string | null> {
  const porcelain = await git(["-C", GEN_DIR, "status", "--porcelain"]);
  for (const line of porcelain.split("\n")) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    let path = line.slice(3).trim();
    if (path.includes(" -> ")) path = path.split(" -> ")[1] ?? path;
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    const underWiki = path === "openwiki" || path === "openwiki/" || path.startsWith("openwiki/");
    if (xy === "??") {
      if (underWiki || path === ".openwikiignore") continue;
      throw new Error(`openwiki created unexpected untracked path: ${path}`);
    }
    if (!underWiki) throw new Error(`openwiki modified files outside openwiki/: ${path}`);
  }

  await git(["-C", GEN_DIR, "branch", "-D", DOCS_BRANCH]).catch(() => {});
  await git(["-C", GEN_DIR, "checkout", "-b", DOCS_BRANCH]);
  await git(["-C", GEN_DIR, "add", "openwiki"]);
  let staged = true;
  try {
    await git(["-C", GEN_DIR, "diff", "--cached", "--quiet"]);
    staged = false; // Exit 0: nothing staged, the wiki is unchanged.
  } catch (err) {
    if ((err as { code?: number })?.code !== 1) throw err; // Exit 1: staged changes exist.
  }
  if (!staged) return null;
  // user.name/user.email come from the git helper's safe config.
  await git(["-C", GEN_DIR, "commit", "-m", "Docs: update OpenWiki"]);
  await git(["-C", GEN_DIR, "push", "--quiet", "origin", `HEAD:refs/heads/${DOCS_BRANCH}`], ctx.githubToken);

  const base = await defaultBranch();
  const existing = await findPullRequest(ctx.githubToken, ctx.repo, DOCS_BRANCH).catch(() => null);
  if (existing?.state === "open") {
    status.branch = DOCS_BRANCH;
    return existing.url;
  }
  try {
    const pr = await createPullRequest(ctx.githubToken, ctx.repo, {
      title: "Docs: update OpenWiki",
      body: "Generated repository documentation via OpenWiki.",
      branch: DOCS_BRANCH,
      base,
    });
    status.branch = DOCS_BRANCH;
    return pr.url;
  } catch (err) {
    // A duplicate PR slipped in between the lookup and the create.
    if (err instanceof Error && /already exists/i.test(err.message)) {
      const retry = await findPullRequest(ctx.githubToken, ctx.repo, DOCS_BRANCH).catch(() => null);
      status.branch = DOCS_BRANCH;
      return retry?.url ?? null;
    }
    throw err;
  }
}
