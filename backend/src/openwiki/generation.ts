import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sendEvent } from "../core/events.js";
import { getSetting } from "../core/settings.js";
import { createPullRequest, findPullRequest } from "../integrations/github.js";
import { getKey } from "../models/Integration.js";
import { type ModelConnection, chatModel, loadConnection } from "../providers/modelProvider.js";
import { defaultBranch, fetchRepo, git, type Repo } from "../repositories/git.js";
import { projectDir, repoDir } from "../projects/projects.js";
import { DEFAULT_OPENWIKIIGNORE } from "./ignoreDefaults.js";
import { loadOpenwiki } from "./openwiki.js";
import { type ScanLog, openScanLog } from "./scanLog.js";
import { errorMessage } from "../core/errors.js";

// The docs branch the wiki update is pushed to.
const DOCS_BRANCH = "docs/openwiki-update";

// The newest pull request from the docs branch, whatever its state, or null when the
// repo has none (or GitHub isn't connected).
export async function findDocsPullRequest(repo: Repo) {
  const token = await getKey("github");
  return token ? findPullRequest(token, repo.githubRepo, DOCS_BRANCH) : null;
}

// Each project's disposable worktree that a scan generates its wiki in.
const genDir = (repo: Repo) => join(projectDir(repo.id), "openwiki-gen");

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

// Each project's scans: one at a time per project, since generation is expensive and two
// runs would fight over the worktree. log is the latest scan's (see scanLog.ts).
type Scan = { running: boolean; status: ScanStatus; log: ScanLog | null };
const scans = new Map<number, Scan>();
function scanOf(repo: Repo) {
  let scan = scans.get(repo.id);
  if (!scan) {
    scan = {
      running: false,
      status: {
        state: "idle",
        startedAt: null,
        error: null,
        ignoreUsed: null,
        branch: null,
        pullRequestUrl: null,
        progress: null,
      },
      log: null,
    };
    scans.set(repo.id, scan);
  }
  return scan;
}

function setProgress(scan: Scan, progress: ScanProgress) {
  scan.status = { ...scan.status, progress };
  sendEvent({ type: "openwiki.updated" });
}

export function getScanStatus(repo: Repo): ScanStatus {
  return { ...scanOf(repo).status };
}

// Forgets the worktree registration and deletes its directory. Never throws.
async function removeWorktree(repo: Repo) {
  await git(["-C", repoDir(repo.id), "worktree", "remove", "--force", genDir(repo)]).catch(() => {});
  await rm(genDir(repo), { recursive: true, force: true }).catch(() => {});
  await git(["-C", repoDir(repo.id), "worktree", "prune"]).catch(() => {});
}

// A fresh detached worktree at origin/HEAD, with an ignore file in place. Returns
// which ignore the run uses: the repo's own, or zini's default (written here, never committed).
async function prepareWorktree(repo: Repo): Promise<"repo" | "default"> {
  await removeWorktree(repo);
  await git(["-C", repoDir(repo.id), "worktree", "add", "--detach", genDir(repo), "origin/HEAD"]);
  const existing = await readFile(join(genDir(repo), ".openwikiignore"), "utf8").catch(() => "");
  if (existing.trim()) return "repo";
  await writeFile(join(genDir(repo), ".openwikiignore"), DEFAULT_OPENWIKIIGNORE);
  return "default";
}

// Starts a scan of the project's repo if none is running. Returns once generation has
// started; the rest of the flow continues in the background and reports through
// getScanStatus() and events.
export async function startScan(repo: Repo): Promise<{ started: boolean; error?: string }> {
  const scan = scanOf(repo);
  if (scan.running) return { started: false, error: "A documentation scan is already running" };
  scan.running = true;
  const notStarted = (error: string) => {
    scan.running = false;
    return { started: false, error };
  };
  try {
    const [githubToken, provider, model] = await Promise.all([
      getKey("github"),
      getSetting("openwikiProvider"),
      getSetting("openwikiModel"),
    ]);
    if (!githubToken) return notStarted("GitHub isn't connected");
    if (!model) return notStarted("Set an OpenWiki model in settings first");
    const connection = await loadConnection(provider);
    if (typeof connection === "string") return notStarted(connection);

    const startedAt = new Date().toISOString();
    scan.status = {
      state: "running",
      startedAt,
      error: null,
      ignoreUsed: null,
      branch: null,
      pullRequestUrl: null,
      progress: null,
    };
    sendEvent({ type: "openwiki.updated" });
    scan.log = await openScanLog(repo, startedAt);
    void scan.log.write({ type: "scan", stage: "started", repo: repo.githubRepo, provider: connection.provider, model });

    await fetchRepo(repo);
    scan.status.ignoreUsed = await prepareWorktree(repo);
    void scan.log.write({ type: "scan", stage: "worktree", ignoreUsed: scan.status.ignoreUsed });
    sendEvent({ type: "openwiki.updated" });

    void runScan(scan, { repo, githubToken, model, connection }).catch((e) => console.error("openwiki scan failed:", e));
    return { started: true };
  } catch (err) {
    const error = errorMessage(err);
    scan.status = { ...scan.status, state: "failed", error };
    void scan.log?.write({ type: "scan", stage: "failed", error });
    scan.running = false;
    sendEvent({ type: "openwiki.updated" });
    await removeWorktree(repo);
    return { started: false, error };
  }
}

type ScanContext = { repo: Repo; githubToken: string; model: string; connection: ModelConnection };

// Generates the wiki in the worktree with zini's own model for the provider, then
// verifies, commits, pushes, and opens the PR. Always removes the worktree and
// releases the mutex, whatever happens.
async function runScan(scan: Scan, ctx: ScanContext) {
  const { log } = scan;
  const root = genDir(ctx.repo);
  try {
    const openwiki = await loadOpenwiki();
    await openwiki.syncBundledSkills();
    const model = chatModel(ctx.connection, ctx.model, { maxRetries: 3 });
    // openwiki keeps a page worker's error to itself, so model errors are logged here.
    model.callbacks = [{ handleLLMError: (err) => void log?.write({ type: "model_error", error: String(err) }) }];
    await openwiki.runNativeRepositoryGeneration({
      root,
      mode: "init",
      modelId: ctx.model,
      model,
      onEvent: (event) => {
        void log?.write(event);
        if (event.type !== "repository_progress") return;
        // When a page's worker gives up, openwiki deletes the page, which fails, and
        // ends the scan, if the page's folder doesn't exist yet. So it exists up front.
        if (event.page) mkdirSync(dirname(join(root, event.page)), { recursive: true });
        setProgress(scan, {
          stage: event.stage,
          page: event.page ?? null,
          pageIndex: event.pageIndex ?? null,
          pageCount: event.pageCount ?? null,
        });
      },
    });
    void log?.write({ type: "scan", stage: "publishing" });
    setProgress(scan, { stage: "publishing", page: null, pageIndex: null, pageCount: null });
    const pullRequestUrl = await publish(scan, ctx);
    scan.status = { ...scan.status, state: "done", error: null, pullRequestUrl };
    void log?.write({ type: "scan", stage: "done", pullRequestUrl });
  } catch (err) {
    const error = errorMessage(err);
    scan.status = { ...scan.status, state: "failed", error };
    void log?.write({ type: "scan", stage: "failed", error, stack: err instanceof Error ? err.stack : undefined });
    console.error(`openwiki scan failed: ${error}`);
  } finally {
    await removeWorktree(ctx.repo);
    scan.running = false;
    sendEvent({ type: "openwiki.updated" });
  }
}

// Commits only openwiki/, pushes it, and opens (or reuses) the docs PR. Anything else
// in the worktree is dropped with it: openwiki also writes an update workflow and an
// AGENTS.md/CLAUDE.md snippet, and our ignore file. Returns the PR URL, or null when
// the wiki is unchanged and there is nothing to publish.
async function publish(scan: Scan, ctx: ScanContext): Promise<string | null> {
  const root = genDir(ctx.repo);
  const repo = ctx.repo.githubRepo;
  await git(["-C", root, "branch", "-D", DOCS_BRANCH]).catch(() => {});
  await git(["-C", root, "checkout", "-b", DOCS_BRANCH]);
  await git(["-C", root, "add", "openwiki"]);
  let staged = true;
  try {
    await git(["-C", root, "diff", "--cached", "--quiet"]);
    staged = false; // Exit 0: nothing staged, the wiki is unchanged.
  } catch (err) {
    if ((err as { code?: number })?.code !== 1) throw err; // Exit 1: staged changes exist.
  }
  if (!staged) return null;
  // user.name/user.email come from the git helper's safe config.
  await git(["-C", root, "commit", "-m", "Docs: update OpenWiki"]);
  // Forced: each scan rebuilds the docs branch from the latest default branch.
  await git(["-C", root, "push", "--quiet", "--force", "origin", `HEAD:refs/heads/${DOCS_BRANCH}`], ctx.githubToken);

  const base = await defaultBranch(ctx.repo);
  const existing = await findPullRequest(ctx.githubToken, repo, DOCS_BRANCH).catch(() => null);
  if (existing?.state === "open") {
    scan.status.branch = DOCS_BRANCH;
    return existing.url;
  }
  try {
    const pr = await createPullRequest(ctx.githubToken, repo, {
      title: "Docs: update OpenWiki",
      body: "Generated repository documentation via OpenWiki.",
      branch: DOCS_BRANCH,
      base,
    });
    scan.status.branch = DOCS_BRANCH;
    return pr.url;
  } catch (err) {
    // A duplicate PR slipped in between the lookup and the create.
    if (err instanceof Error && /already exists/i.test(err.message)) {
      const retry = await findPullRequest(ctx.githubToken, repo, DOCS_BRANCH).catch(() => null);
      scan.status.branch = DOCS_BRANCH;
      return retry?.url ?? null;
    }
    throw err;
  }
}
