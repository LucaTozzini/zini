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

// Everything changed in the workspace since it branched from the default branch, as a
// unified diff: changes to tracked files (committed or not), then each new untracked
// file diffed against nothing, so it shows as a new file. Ignored files are left out.
// Nothing is staged or committed.
export async function workspaceDiff(issueId: string): Promise<WorkspaceDiff> {
  const base = (await inWorkspace(issueId, ["merge-base", "HEAD", "origin/HEAD"])).trim();
  let diff = await inWorkspace(issueId, ["diff", "--no-color", base]);

  const status = await inWorkspace(issueId, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  const untracked = status
    .split("\0")
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => entry.slice(3));
  for (const file of untracked) {
    if (diff.length > MAX_DIFF_CHARS) break;
    diff += await inWorkspace(issueId, ["diff", "--no-color", "--no-index", "--", "/dev/null", file], true);
  }

  const truncated = diff.length > MAX_DIFF_CHARS;
  if (truncated) diff = diff.slice(0, diff.lastIndexOf("\ndiff --git ", MAX_DIFF_CHARS) + 1 || MAX_DIFF_CHARS);
  return { diff, truncated };
}
