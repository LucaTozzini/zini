import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { storage } from "./db.js";
import { getKey } from "./models/Integration.js";
import { getSetting } from "./settings.js";

const execFileAsync = promisify(execFile);

// A bare clone of the githubRepo setting: git's history only, no checked-out files.
// Code is read from REF, which fetches keep in line with GitHub's default branch.
// Absolute, since git runs with -C REPO_DIR and would read a relative path from there.
const REPO_DIR = resolve(dirname(storage), "repo.git");
const REF = "origin/HEAD";

// Caps so a big file or a common search term doesn't flood the model's context.
const MAX_FILE_CHARS = 50_000;
const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 300;

// Runs git and returns stdout. With a token, it's passed as an auth header for this
// command only (via env, so it never lands in the clone's config or on the command line),
// and credential helpers are off so git never prompts.
async function git(args: string[], token?: string) {
  const auth = token
    ? {
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "http.extraHeader",
        GIT_CONFIG_VALUE_1: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      }
    : {};
  const { stdout } = await execFileAsync("git", args, {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      // Abort a clone or fetch that has stalled (under 1 KB/s for 30s), without
      // cutting off a big one that's still downloading.
      GIT_HTTP_LOW_SPEED_LIMIT: "1000",
      GIT_HTTP_LOW_SPEED_TIME: "30",
      ...auth,
    },
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

// Clone and fetch write to the same directory, so they run one at a time.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const repoUrl = (repo: string) => `https://github.com/${repo}.git`;

async function requireToken() {
  const token = await getKey("github");
  if (!token) throw new Error("GitHub isn't connected");
  return token;
}

// Clones repo ("owner/name") in place of any existing clone. Does nothing if it's
// already cloned. Throws if the clone fails, leaving the existing clone as it was.
export function cloneRepo(repo: string) {
  return exclusive(async () => {
    const url = repoUrl(repo);
    if (existsSync(REPO_DIR)) {
      const current = await git(["-C", REPO_DIR, "config", "remote.origin.url"]).catch(() => "");
      if (current.trim().toLowerCase() === url.toLowerCase()) return;
    }

    const token = await requireToken();
    const tmp = `${REPO_DIR}.tmp`;
    await rm(tmp, { recursive: true, force: true });
    try {
      await git(["clone", "--bare", "--quiet", url, tmp], token);
      // A bare clone has no remote-tracking branches; fetch into origin/* like a
      // normal clone, and point origin/HEAD at the default branch.
      await git(["-C", tmp, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
      await git(["-C", tmp, "fetch", "--quiet", "origin"], token);
      const branch = (await git(["-C", tmp, "symbolic-ref", "--short", "HEAD"])).trim();
      await git(["-C", tmp, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${branch}`]);
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      throw err;
    }
    await rm(REPO_DIR, { recursive: true, force: true });
    await rename(tmp, REPO_DIR);
  });
}

// The fetch in progress, if any. Callers that arrive while it runs (e.g. the PM's
// parallel tool calls) share it, and its outcome, instead of each fetching.
let fetching: Promise<void> | null = null;

// Brings the clone up to date with GitHub, cloning it first if it's missing.
export function fetchRepo() {
  fetching ??= updateRepo().finally(() => {
    fetching = null;
  });
  return fetching;
}

async function updateRepo() {
  const repo = await getSetting("githubRepo");
  if (!repo) throw new Error("No GitHub repo set");
  if (!existsSync(REPO_DIR)) return cloneRepo(repo);
  const token = await requireToken();
  await exclusive(() => git(["-C", REPO_DIR, "fetch", "--quiet", "--prune", "origin"], token));
}

// Workspaces are git worktrees of the clone: real folders, each with its own branch
// checked out, sharing repo.git's history. Named by Linear issue id, which never changes.
const WORKSPACES_DIR = resolve(dirname(storage), "workspaces");

export const workspacePath = (issueId: string) => join(WORKSPACES_DIR, issueId);

// Checks out branch in a new worktree for the issue. Continues origin/<branch> if
// someone already pushed it, otherwise starts it from the default branch. Fetch
// first, so both are current. -B, not -b: the bare clone copied every branch that
// existed when it was made, so a stale local copy may already exist to be reset.
export function addWorktree(issueId: string, branch: string) {
  return exclusive(async () => {
    const remote = `refs/remotes/origin/${branch}`;
    const onRemote = await git(["-C", REPO_DIR, "rev-parse", "--verify", "--quiet", remote])
      .then(() => true)
      .catch(() => false);
    await git([
      "-C", REPO_DIR, "worktree", "add", "--quiet",
      "-B", branch, workspacePath(issueId), onRemote ? remote : REF,
    ]);
  });
}

// The branch checked out in the issue's worktree.
export async function worktreeBranch(issueId: string) {
  const path = workspacePath(issueId);
  if (!existsSync(path)) throw new Error("The workspace folder is missing");
  return (await git(["-C", path, "branch", "--show-current"])).trim();
}

// Deletes the issue's worktree, including uncommitted changes, and its local branch.
// The branch on GitHub is left alone. If the folder was already deleted by hand,
// this just clears git's record of it.
export async function removeWorktree(issueId: string) {
  const path = workspacePath(issueId);
  const branch = existsSync(path) ? await worktreeBranch(issueId) : "";
  await exclusive(async () => {
    if (existsSync(path)) {
      await git(["-C", REPO_DIR, "worktree", "remove", "--force", path]);
    } else {
      await git(["-C", REPO_DIR, "worktree", "prune"]);
    }
    if (branch) await git(["-C", REPO_DIR, "branch", "-D", branch]);
  });
}

// "src/App.tsx", "./src/App.tsx" and "/src/App.tsx" all mean the same file; "" is the root.
const cleanPath = (path: string) => path.trim().replace(/^\.?\/+/, "").replace(/\/+$/, "");

async function objectType(path: string) {
  return (await git(["-C", REPO_DIR, "cat-file", "-t", `${REF}:${path}`]).catch(() => "")).trim();
}

// The entries of a folder on the default branch, folders ending in "/".
export async function listRepoFiles(path: string) {
  path = cleanPath(path);
  const type = path ? await objectType(path) : "tree";
  if (type !== "tree") throw new Error(type ? `${path} is a file` : `No folder at ${path}`);
  const out = await git(["-C", REPO_DIR, "ls-tree", path ? `${REF}:${path}` : REF]);
  // Each line is "<mode> <type> <hash>\t<name>".
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const name = line.slice(line.indexOf("\t") + 1);
      return line.split(" ")[1] === "tree" ? `${name}/` : name;
    })
    .join("\n");
}

// A file's lines on the default branch, numbered like "12\ttext", from startLine to
// endLine (1-based, inclusive). Stops after about MAX_FILE_CHARS, with a note saying
// where to continue.
export async function readRepoFile(path: string, startLine = 1, endLine?: number) {
  path = cleanPath(path);
  const type = await objectType(path);
  if (type !== "blob") throw new Error(type ? `${path} is a folder` : `No file at ${path}`);
  const content = await git(["-C", REPO_DIR, "show", `${REF}:${path}`]);
  if (content.slice(0, 8000).includes("\0")) return `${path} is a binary file`;

  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const total = lines.length;
  if (startLine > total) throw new Error(`${path} has only ${total} lines`);
  const last = Math.min(endLine ?? total, total);

  const out: string[] = [];
  let chars = 0;
  let n = startLine;
  for (; n <= last; n++) {
    // A single huge line (e.g. minified code) is cut on its own.
    const line = `${n}\t${lines[n - 1]}`.slice(0, MAX_FILE_CHARS);
    if (out.length && chars + line.length > MAX_FILE_CHARS) break;
    out.push(line);
    chars += line.length + 1;
  }
  if (n <= last) {
    out.push(`[Cut off at line ${n - 1} of ${total}. Read on with startLine ${n}.]`);
  } else if (startLine > 1 || last < total) {
    out.push(`[Lines ${startLine}-${last} of ${total}]`);
  }
  return out.join("\n");
}

// Lines on the default branch containing query (plain text, any case), as
// "path:line:text", up to MAX_MATCHES.
export async function searchRepoCode(query: string) {
  let out: string;
  try {
    out = await git(["-C", REPO_DIR, "grep", "-n", "-I", "-i", "-F", "-e", query, REF]);
  } catch (err) {
    // git grep exits with 1 when nothing matches.
    if ((err as { code?: number }).code === 1) return "No matches";
    throw err;
  }
  const lines = out.split("\n").filter(Boolean);
  const matches = lines
    .slice(0, MAX_MATCHES)
    .map((line) => line.slice(REF.length + 1, REF.length + 1 + MAX_LINE_CHARS));
  if (lines.length > MAX_MATCHES) {
    matches.push(`[${lines.length - MAX_MATCHES} more matches; search for something more specific]`);
  }
  return matches.join("\n");
}
