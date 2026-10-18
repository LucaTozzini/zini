import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { storage } from "../db.js";
import { sendEvent } from "../core/events.js";
import { getSetting } from "../core/settings.js";
import { createPullRequest, findPullRequest } from "../integrations/github.js";
import { getKey } from "../models/Integration.js";
import { type ModelConnection, chatModel, loadConnection } from "../providers/modelProvider.js";
import { REPO_DIR, defaultBranch, fetchRepo, git } from "../repositories/git.js";
import { DEFAULT_OPENWIKIIGNORE } from "./ignoreDefaults.js";
import { loadOpenwiki } from "./openwiki.js";
import { type ScanLog, openScanLog } from "./scanLog.js";
import { errorMessage } from "../core/errors.js";

// The docs branch the wiki update is pushed to.
const DOCS_BRANCH = "docs/openwiki-update";

const GEN_DIR = resolve(dirname(storage), "openwiki-gen");

export type ScanState = "idle" | "running" | "failed" | "done";

export type ScanStatus = {
  state: ScanState;
  startedAt: string | null;
  error: string | null;
  ignoreUsed: "repo" | "default" | null;
  branch: string | null;
  pullRequestUrl: string | null;
  // The scan's latest step: openwiki's stages (planning, generating, finalizing),
  // then publishing. page and its index are set while generating.
  progress: ScanProgress | null;
};

export type ScanProgress = { stage: string; page: string | null; pageIndex: number | null; pageCount: number | null };

// One scan at a time: generation is expensive and two runs would fight over the worktree.
let running = false;
let status: ScanStatus = {
  state: "idle",
  startedAt: null,
  error: null,
  ignoreUsed: null,
  branch: null,
  pullRequestUrl: null,
  progress: null,
};
// The latest scan's log (see scanLog.ts).
let log: ScanLog | null = null;

function setProgress(progress: ScanProgress) {
  status = { ...status, progress };
  sendEvent({ type: "openwiki.updated" });
}

export function getScanStatus(): ScanStatus {
  return { ...status };
}

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

// Starts a scan if none is running. Returns once generation has started; the rest of
// the flow continues in the background and reports through getScanStatus() and events.
export async function startScan(): Promise<{ started: boolean; error?: string }> {
  if (running) return { started: false, error: "A documentation scan is already running" };
  running = true;
  const notStarted = (error: string) => {
    running = false;
    return { started: false, error };
  };
  try {
    const [repo, githubToken, provider, model] = await Promise.all([
      getSetting("githubRepo"),
      getKey("github"),
      getSetting("openwikiProvider"),
      getSetting("openwikiModel"),
    ]);
    if (!repo) return notStarted("Set a GitHub repository first");
    if (!githubToken) return notStarted("GitHub isn't connected");
    if (!model) return notStarted("Set an OpenWiki model in settings first");
    const connection = await loadConnection(provider);
    if (typeof connection === "string") return notStarted(connection);

    const startedAt = new Date().toISOString();
    status = {
      state: "running",
      startedAt,
      error: null,
      ignoreUsed: null,
      branch: null,
      pullRequestUrl: null,
      progress: null,
    };
    sendEvent({ type: "openwiki.updated" });
    log = await openScanLog(startedAt);
    void log.write({ type: "scan", stage: "started", repo, provider: connection.provider, model });

    await fetchRepo();
    status.ignoreUsed = await prepareWorktree();
    void log.write({ type: "scan", stage: "worktree", ignoreUsed: status.ignoreUsed });
    sendEvent({ type: "openwiki.updated" });

    void runScan({ repo, githubToken, model, connection }).catch((e) => console.error("openwiki scan failed:", e));
    return { started: true };
  } catch (err) {
    const error = errorMessage(err);
    status = { ...status, state: "failed", error };
    void log?.write({ type: "scan", stage: "failed", error });
    running = false;
    sendEvent({ type: "openwiki.updated" });
    await removeWorktree();
    return { started: false, error };
  }
}

type ScanContext = { repo: string; githubToken: string; model: string; connection: ModelConnection };

// Generates the wiki in the worktree with zini's own model for the provider, then
// verifies, commits, pushes, and opens the PR. Always removes the worktree and
// releases the mutex, whatever happens.
async function runScan(ctx: ScanContext) {
  try {
    const openwiki = await loadOpenwiki();
    await openwiki.syncBundledSkills();
    const model = chatModel(ctx.connection, ctx.model, { maxRetries: 3 });
    // openwiki keeps a page worker's error to itself, so model errors are logged here.
    model.callbacks = [{ handleLLMError: (err) => void log?.write({ type: "model_error", error: String(err) }) }];
    await openwiki.runNativeRepositoryGeneration({
      root: GEN_DIR,
      mode: "init",
      modelId: ctx.model,
      model,
      onEvent: (event) => {
        void log?.write(event);
        if (event.type !== "repository_progress") return;
        // When a page's worker gives up, openwiki deletes the page, which fails, and
        // ends the scan, if the page's folder doesn't exist yet. So it exists up front.
        if (event.page) mkdirSync(dirname(join(GEN_DIR, event.page)), { recursive: true });
        setProgress({
          stage: event.stage,
          page: event.page ?? null,
          pageIndex: event.pageIndex ?? null,
          pageCount: event.pageCount ?? null,
        });
      },
    });
    void log?.write({ type: "scan", stage: "publishing" });
    setProgress({ stage: "publishing", page: null, pageIndex: null, pageCount: null });
    const pullRequestUrl = await publish(ctx);
    status = { ...status, state: "done", error: null, pullRequestUrl };
    void log?.write({ type: "scan", stage: "done", pullRequestUrl });
  } catch (err) {
    const error = errorMessage(err);
    status = { ...status, state: "failed", error };
    void log?.write({ type: "scan", stage: "failed", error, stack: err instanceof Error ? err.stack : undefined });
    console.error(`openwiki scan failed: ${error}`);
  } finally {
    await removeWorktree();
    running = false;
    sendEvent({ type: "openwiki.updated" });
  }
}

// Commits only openwiki/, pushes it, and opens (or reuses) the docs PR. Anything else
// in the worktree is dropped with it: openwiki also writes an update workflow and an
// AGENTS.md/CLAUDE.md snippet, and our ignore file. Returns the PR URL, or null when
// the wiki is unchanged and there is nothing to publish.
async function publish(ctx: ScanContext): Promise<string | null> {
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
  // Forced: each scan rebuilds the docs branch from the latest default branch.
  await git(["-C", GEN_DIR, "push", "--quiet", "--force", "origin", `HEAD:refs/heads/${DOCS_BRANCH}`], ctx.githubToken);

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
