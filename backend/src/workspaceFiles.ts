import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkspaceDiff } from "shared";
import { cleanPath, formatMatches, git, numberedLines, workspacePath } from "./git.js";

// The files of an issue's workspace, as the pipeline's subagents see and change them:
// the checkout on disk, uncommitted edits included. Paths are relative to the
// workspace and can't leave it or touch its .git.

// The largest diff sent to the webapp; beyond it, it's cut off and marked truncated.
const MAX_DIFF_CHARS = 2 * 1024 * 1024;

// A path inside the workspace: the full path, and the path relative to the workspace
// with forward slashes. Throws for one outside it, or in its .git.
function resolveIn(issueId: string, path: string) {
  const root = workspacePath(issueId);
  const full = resolve(root, cleanPath(path));
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${path} is outside the workspace`);
  if (rel.split(sep)[0] === ".git") throw new Error("The .git folder can't be read or changed");
  return { full, rel: rel.split(sep).join("/") };
}

const inWorkspace = (issueId: string, args: string[], exit1Ok = false) =>
  git(["-C", workspacePath(issueId), ...args], undefined, { exit1Ok });

// A folder's files and subfolders (subfolders end in /), skipping what git ignores
// (e.g. node_modules).
export async function listWorkspaceFiles(issueId: string, path: string) {
  const { rel } = resolveIn(issueId, path);
  const prefix = rel ? `${rel}/` : "";
  // Tracked and untracked files, minus ignored ones; deleted files are still listed as
  // tracked, so they're checked for on disk.
  const out = await inWorkspace(issueId, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const entries = new Set<string>();
  for (const file of out.split("\0")) {
    if (!file || !file.startsWith(prefix) || !existsSync(resolve(workspacePath(issueId), file))) continue;
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    entries.add(slash === -1 ? rest : `${rest.slice(0, slash)}/`);
  }
  if (entries.size === 0) throw new Error(`No folder at ${path || "the workspace root"}, or it's empty`);
  return [...entries].sort().join("\n");
}

export async function readWorkspaceFile(issueId: string, path: string, startLine?: number, endLine?: number) {
  const { full, rel } = resolveIn(issueId, path);
  if (!existsSync(full)) throw new Error(`No file at ${rel}`);
  if ((await stat(full)).isDirectory()) throw new Error(`${rel} is a folder`);
  return numberedLines(rel, await readFile(full, "utf8"), startLine, endLine);
}

// Lines containing query (plain text, any case), as "path:line:text", in tracked and
// untracked files but not ignored ones.
export async function searchWorkspace(issueId: string, query: string) {
  const out = await inWorkspace(issueId, ["grep", "-n", "-I", "-i", "-F", "--untracked", "-e", query], true);
  return formatMatches(out.split("\n"));
}

export async function writeWorkspaceFile(issueId: string, path: string, content: string) {
  const { full, rel } = resolveIn(issueId, path);
  if (existsSync(full) && (await stat(full)).isDirectory()) throw new Error(`${rel} is a folder`);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
  return `Wrote ${rel}`;
}

// Replaces the one place oldText appears in the file with newText.
export async function editWorkspaceFile(issueId: string, path: string, oldText: string, newText: string) {
  const { full, rel } = resolveIn(issueId, path);
  if (!existsSync(full)) throw new Error(`No file at ${rel}`);
  let content = await readFile(full, "utf8");
  // A file with Windows line endings: match and write them too.
  if (content.includes("\r\n")) {
    oldText = oldText.replace(/\r?\n/g, "\r\n");
    newText = newText.replace(/\r?\n/g, "\r\n");
  }
  const count = content.split(oldText).length - 1;
  if (count === 0) throw new Error(`oldText isn't in ${rel}; read the file and copy the text exactly`);
  if (count > 1) throw new Error(`oldText appears ${count} times in ${rel}; include more lines around it`);
  content = content.replace(oldText, () => newText);
  await writeFile(full, content);
  return `Edited ${rel}`;
}

export async function deleteWorkspaceFile(issueId: string, path: string) {
  const { full, rel } = resolveIn(issueId, path);
  if (!existsSync(full)) throw new Error(`No file at ${rel}`);
  if ((await stat(full)).isDirectory()) throw new Error(`${rel} is a folder`);
  await rm(full);
  return `Deleted ${rel}`;
}

// The commit the workspace branched from on the default branch.
async function diffBase(issueId: string) {
  return (await inWorkspace(issueId, ["merge-base", "HEAD", "origin/HEAD"])).trim();
}

// New files git doesn't track yet, minus ignored ones.
async function untrackedFiles(issueId: string) {
  const status = await inWorkspace(issueId, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  return status
    .split("\0")
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => entry.slice(3));
}

const isIn = (file: string, path: string) => !path || file === path || file.startsWith(`${path}/`);

// What a diff compares against: where the workspace branched, or, for only what's not
// committed yet, its last commit.
const baseFor = async (issueId: string, uncommitted: boolean) =>
  uncommitted ? "HEAD" : diffBase(issueId);

// Everything changed in the workspace since it branched from the default branch, as a
// unified diff: changes to tracked files (committed or not), then each new untracked
// file diffed against nothing, so it shows as a new file. Ignored files are left out.
// With a path, only the changes to that file or folder; with uncommitted, only the
// changes since the last commit. Nothing is staged or committed.
export async function workspaceDiff(issueId: string, path = "", uncommitted = false): Promise<WorkspaceDiff> {
  const rel = path && resolveIn(issueId, path).rel;
  const base = await baseFor(issueId, uncommitted);
  let diff = await inWorkspace(issueId, ["diff", "--no-color", "--no-renames", base, "--", ...(rel ? [rel] : [])]);

  for (const file of (await untrackedFiles(issueId)).filter((file) => isIn(file, rel))) {
    if (diff.length > MAX_DIFF_CHARS) break;
    diff += await inWorkspace(issueId, ["diff", "--no-color", "--no-index", "--", "/dev/null", file], true);
  }

  const truncated = diff.length > MAX_DIFF_CHARS;
  if (truncated) diff = diff.slice(0, diff.lastIndexOf("\ndiff --git ", MAX_DIFF_CHARS) + 1 || MAX_DIFF_CHARS);
  return { diff, truncated };
}

// Each file changed since the workspace branched (or, with uncommitted, since its last
// commit), as in workspaceDiff, with its lines added and removed ("-" for a binary
// file), in path order.
export async function workspaceChanges(issueId: string, uncommitted = false) {
  const base = await baseFor(issueId, uncommitted);
  // Each record is "added\tremoved\tpath".
  const numstat = await inWorkspace(issueId, ["diff", "--numstat", "-z", "--no-renames", base]);
  const changes = numstat
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const [added, removed, ...rest] = record.split("\t");
      return { path: rest.join("\t"), added, removed, isNew: false };
    });
  for (const file of await untrackedFiles(issueId)) {
    const content = await readFile(resolve(workspacePath(issueId), file), "utf8").catch(() => "");
    const binary = content.slice(0, 8000).includes("\0");
    const lines = content.split("\n").length - (content === "" || content.endsWith("\n") ? 1 : 0);
    changes.push({ path: file, added: binary ? "-" : String(lines), removed: binary ? "-" : "0", isNew: true });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

// ---- Committing ----------------------------------------------------------------------

// The subjects of the commits on the workspace's branch since it branched, oldest first.
export async function branchCommits(issueId: string) {
  const base = await diffBase(issueId);
  const out = await inWorkspace(issueId, ["log", "--reverse", "--format=%s", `${base}..HEAD`]);
  return out.split("\n").filter(Boolean);
}

// The whole messages (subject and body) of the commits on the workspace's branch since
// it branched, oldest first.
export async function branchCommitMessages(issueId: string) {
  const base = await diffBase(issueId);
  // Each message ends with a NUL, since a body can hold blank lines.
  const out = await inWorkspace(issueId, ["log", "--reverse", "--format=%B%x00", `${base}..HEAD`]);
  return out.split("\0").map((message) => message.trim()).filter(Boolean);
}

// Whether anything isn't committed yet: changed, deleted or new files, not ignored ones.
export async function hasUncommitted(issueId: string) {
  return (await inWorkspace(issueId, ["status", "--porcelain"])).trim() !== "";
}

// The branch's copy of GitHub's branch (origin/<branch>), or null if it's never been
// pushed. A push moves it; a fetch updates it, and removes it once the branch is
// deleted on GitHub.
async function remoteBranch(issueId: string) {
  const branch = (await inWorkspace(issueId, ["branch", "--show-current"])).trim();
  const remote = `refs/remotes/origin/${branch}`;
  return inWorkspace(issueId, ["rev-parse", "--verify", "--quiet", remote])
    .then(() => remote)
    .catch(() => null);
}

// Whether the branch is on GitHub.
export const isPushed = async (issueId: string) => (await remoteBranch(issueId)) !== null;

// Whether the branch has commits GitHub doesn't: past origin/<branch> if it's been
// pushed, otherwise any since the workspace branched.
export async function hasUnpushed(issueId: string) {
  const from = (await remoteBranch(issueId)) ?? (await diffBase(issueId));
  return Number(await inWorkspace(issueId, ["rev-list", "--count", `${from}..HEAD`])) > 0;
}

// Commits everything not committed yet (new files included, ignored ones not), as the
// machine's git user.
export async function commitAll(issueId: string, message: string) {
  await inWorkspace(issueId, ["add", "-A"]);
  await inWorkspace(issueId, ["commit", "--quiet", "-m", message]);
}
