import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { storage } from "../db.js";
import { getKey } from "../models/Integration.js";
import type { Project } from "../models/Project.js";
import { repoDir, workspaceProject } from "../projects/projects.js";
import { withWorkspaceLock } from "../workspaces/workspaceLocks.js";
import { trustedGit } from "../workspaces/trustedGit.js";
import { cloneWorkspaceVolume, ensureWorkspaceVolume, workspaceGit } from "../workspaces/workspaceVolumes.js";

const execFileAsync = promisify(execFile);

// Each project has a bare clone of its repo (see repoDir): git's history only, no
// checked-out files. Code is read from REF, which fetches keep in line with GitHub's
// default branch.
const REF = "origin/HEAD";

// A project's repo: its id, for its clone, and its GitHub repository, "owner/name".
export type Repo = Pick<Project, "id" | "githubRepo">;

// Each workspace is an independent clone with its own history and metadata.
const WORKSPACES_DIR = resolve(dirname(storage), "workspaces");

// Caps so a big file or a common search term doesn't flood the model's context.
const MAX_FILE_CHARS = 50_000;
const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 300;

// Runs git and returns stdout. With a token, it's passed as an auth header for this
// command only (via env, so it never lands in the clone's config or on the command line),
// and credential helpers are off so git never prompts. exit1Ok: exit code 1 isn't a
// failure (git grep with no matches, git diff --no-index with differences).
export async function git(args: string[], token?: string, { exit1Ok = false } = {}) {
  try {
    const directory = args[0] === "-C" ? args[1] : undefined;
    const prefix = `${WORKSPACES_DIR}${process.platform === "win32" ? "\\" : "/"}`;
    const id = directory?.startsWith(prefix) ? directory.slice(prefix.length) : "";
    if (/^[a-zA-Z0-9_-]+$/.test(id)) return await workspaceGit(id, args.slice(2), token);
    return await executeGit(args, token);
  } catch (err) {
    const { code, stdout } = err as { code?: number; stdout?: string };
    if (exit1Ok && code === 1) return stdout ?? "";
    throw err;
  }
}

async function executeGit(args: string[], token?: string) {
  const auth = token
    ? {
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "http.extraHeader",
        GIT_CONFIG_VALUE_1: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      }
    : {};
  const safe = [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    // On Windows, checkouts under data/projects/<id>/ can pass the 260-character path limit.
    "core.longpaths=true",
    "-c",
    "core.pager=cat",
    "-c",
    "credential.helper=",
    "-c",
    "core.sshCommand=false",
    "-c",
    "protocol.ext.allow=never",
    "-c",
    "protocol.file.allow=never",
    "-c",
    "user.name=Zini",
    "-c",
    "user.email=zini@localhost",
  ];
  const { stdout } = await execFileAsync("git", [...safe, ...args], {
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      // git never looks for a repo above the workspaces folder: a workspace that has
      // lost its .git link then fails, rather than git finding whatever repo contains
      // zini's data folder (e.g. zini's own checkout) and acting on that.
      GIT_CEILING_DIRECTORIES: WORKSPACES_DIR,
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

const repoUrl = (repo: string) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid GitHub repository");
  return `https://github.com/${repo}.git`;
};

async function requireToken() {
  const token = await getKey("github");
  if (!token) throw new Error("GitHub isn't connected");
  return token;
}

// Clones the project's repo, unless it's already cloned. Throws if the clone fails,
// leaving nothing behind.
export function cloneRepo({ id, githubRepo }: Repo) {
  return exclusive(async () => {
    const dir = repoDir(id);
    if (existsSync(dir)) return;
    const url = repoUrl(githubRepo);
    const token = await requireToken();
    const tmp = `${dir}.tmp`;
    await mkdir(dirname(dir), { recursive: true });
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
    await rename(tmp, dir);
  });
}

// The fetch in progress for each project, if any. Callers that arrive while it runs
// (e.g. the Project Lead's parallel tool calls) share it, and its outcome, instead of
// each fetching.
const fetching = new Map<number, Promise<void>>();

// Brings the project's clone up to date with GitHub, cloning it first if it's missing.
export function fetchRepo(repo: Repo) {
  let fetch = fetching.get(repo.id);
  if (!fetch) {
    fetch = updateRepo(repo).finally(() => fetching.delete(repo.id));
    fetching.set(repo.id, fetch);
  }
  return fetch;
}

async function updateRepo(repo: Repo) {
  if (!existsSync(repoDir(repo.id))) return cloneRepo(repo);
  const token = await requireToken();
  await exclusive(() => git(["-C", repoDir(repo.id), "fetch", "--quiet", "--prune", "origin"], token));
}

export const workspacePath = (issueId: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(issueId)) throw new Error("Invalid workspace ID");
  return join(WORKSPACES_DIR, issueId);
};

// Create an independent clone from the trusted bare cache; continue a pushed
// branch when present.
export async function remoteBranches(repo: Repo) {
  const out = await git(["-C", repoDir(repo.id), "for-each-ref", "--format=%(refname:strip=3)", "refs/remotes/origin/"]);
  return out
    .trim()
    .split("\n")
    .filter((name) => name && name !== "HEAD");
}

export function cloneWorkspace(repo: Repo, issueId: string, branch: string, target?: string, requireRemote = false) {
  return exclusive(async () => {
    const dir = repoDir(repo.id);
    const remote = `refs/remotes/origin/${branch}`;
    const onRemote = await git(["-C", dir, "rev-parse", "--verify", "--quiet", remote])
      .then(() => true)
      .catch(() => false);
    if (requireRemote && !onRemote) throw new Error("The selected PR branch is unavailable on the remote");
    await cloneWorkspaceVolume(
      issueId,
      dir,
      branch,
      onRemote ? remote : REF,
      (await git(["-C", dir, "config", "remote.origin.url"])).trim(),
      `refs/remotes/origin/${target ?? (await defaultBranch(repo))}`,
    );
  });
}

// The branch checked out in the issue's Docker workspace.
export async function workspaceBranch(issueId: string) {
  const path = workspacePath(issueId);
  await ensureWorkspaceVolume(issueId);
  return (await git(["-C", path, "branch", "--show-current"])).trim();
}

// The name of GitHub's default branch, e.g. "main", which REF follows.
export async function defaultBranch(repo: Repo) {
  const ref = (await git(["-C", repoDir(repo.id), "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
  return ref.replace(/^origin\//, "");
}

// Push the independent clone's branch to its project's GitHub repository.
export async function pushBranch(issueId: string) {
  const branch = await workspaceBranch(issueId);
  const token = await requireToken();
  const { githubRepo } = await workspaceProject(issueId);
  // Updates origin/<branch> too, which the clone's fetch shares, so one at a time.
  await exclusive(async () => {
    await git(["-C", workspacePath(issueId), "push", "--quiet", repoUrl(githubRepo), `HEAD:refs/heads/${branch}`], token);
    await git(["-C", workspacePath(issueId), "update-ref", `refs/remotes/origin/${branch}`, "HEAD"]);
  });
}

// Authenticated Git runs in a temporary trusted container, using the configured URL
// rather than sandbox-controlled remotes. Merge preserves history and refuses dirty edits.
export async function syncWorkspace(issueId: string, merge = false) {
  await ensureWorkspaceVolume(issueId);
  return withWorkspaceLock(issueId, () =>
    trustedGit(workspacePath(issueId), async () => {
      const { isRunning } = await import("../agents/runs.js");
      if (isRunning(`forge:${issueId}`)) throw new Error("Pause the Forge before syncing its workspace");
      const path = workspacePath(issueId);
      const token = await requireToken();
      const { githubRepo } = await workspaceProject(issueId);
      await git(["-C", path, "fetch", "--quiet", "--prune", repoUrl(githubRepo), "+refs/heads/*:refs/remotes/origin/*"], token);
      if (merge) {
        const { assertNoMerge, workspaceContext } = await import("../workspaces/workspaceIntegration.js");
        await assertNoMerge(issueId);
        if ((await git(["-C", path, "status", "--porcelain"])).trim())
          throw new Error("Workspace has unfinished edits. Fetch completed; commit or resolve them before merging.");
        const branch = (await workspaceContext(issueId)).targetBranch;
        await git(["-C", path, "merge", "--no-edit", `refs/remotes/origin/${branch}`]);
      }
      return { fetched: true, merged: merge };
    }),
  );
}

// Remove the host's volume-reference marker; repository files live in Docker.
export async function removeWorkspaceMarker(issueId: string) {
  const path = workspacePath(issueId);
  await rm(join(path, ".docker-volume"), { force: true });
  await rmdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

// "src/App.tsx", "./src/App.tsx" and "/src/App.tsx" all mean the same file; "" is the root.
export const cleanPath = (path: string) =>
  path
    .trim()
    .replace(/^\.?\/+/, "")
    .replace(/\/+$/, "");

async function objectType(repo: Repo, path: string) {
  return (await git(["-C", repoDir(repo.id), "cat-file", "-t", `${REF}:${path}`]).catch(() => "")).trim();
}

// The entries of a folder on the default branch, folders ending in "/".
export async function listRepoFiles(repo: Repo, path: string) {
  path = cleanPath(path);
  const type = path ? await objectType(repo, path) : "tree";
  if (type !== "tree") throw new Error(type ? `${path} is a file` : `No folder at ${path}`);
  const out = await git(["-C", repoDir(repo.id), "ls-tree", path ? `${REF}:${path}` : REF]);
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
export async function readRepoFile(repo: Repo, path: string, startLine = 1, endLine?: number) {
  path = cleanPath(path);
  const type = await objectType(repo, path);
  if (type !== "blob") throw new Error(type ? `${path} is a folder` : `No file at ${path}`);
  return numberedLines(path, await git(["-C", repoDir(repo.id), "show", `${REF}:${path}`]), startLine, endLine);
}

// A file's content for a model: its lines numbered like "12\ttext", from startLine to
// endLine (1-based, inclusive), stopping after about MAX_FILE_CHARS with a note saying
// where to continue.
export function numberedLines(path: string, content: string, startLine = 1, endLine?: number) {
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

// Lockfiles, left out of searches: they name every package, so common words match
// hundreds of their lines, crowding out the code.
const LOCKFILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock"];

// Lines on the default branch matching query (any case), as "path:line:text", up to
// MAX_MATCHES. query is plain text, or with regex an extended regex (e.g. "a|b").
// Lockfiles aren't searched.
export async function searchRepoCode(repo: Repo, query: string, regex = false) {
  const exclude = LOCKFILES.map((name) => `:(exclude,glob)**/${name}`);
  // git grep exits with 1 when nothing matches. Its lines start with "origin/HEAD:".
  const out = await git(
    ["-C", repoDir(repo.id), "grep", "-n", "-I", "-i", regex ? "-E" : "-F", "-e", query, REF, "--", ".", ...exclude],
    undefined,
    { exit1Ok: true },
  );
  return formatMatches(out.split("\n").map((line) => line.slice(REF.length + 1)));
}

// git grep's "path:line:text" lines for a model: up to MAX_MATCHES, each cut to
// MAX_LINE_CHARS.
export function formatMatches(lines: string[]) {
  lines = lines.filter(Boolean);
  if (lines.length === 0) return "No matches";
  const matches = lines.slice(0, MAX_MATCHES).map((line) => line.slice(0, MAX_LINE_CHARS));
  if (lines.length > MAX_MATCHES) {
    matches.push(`[${lines.length - MAX_MATCHES} more matches; search for something more specific]`);
  }
  return matches.join("\n");
}
