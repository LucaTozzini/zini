import { createHash } from "node:crypto";
import type { WorkspaceDiff } from "shared";
import { git, workspacePath } from "../repositories/git.js";
import { workspaceRequest } from "./workspaceSandbox.js";
import { repositoryPath } from "../repositories/repositoryFilesystem.js";

// The files of an issue's workspace, as the pipeline's subagents see and change them:
// the checkout in a Linux Docker volume, uncommitted edits included. Content I/O goes
// through the gateway; trusted Git uses a temporary container on the same volume.

// The largest diff sent to the webapp; beyond it, it's cut off and marked truncated.
const MAX_DIFF_CHARS = 2 * 1024 * 1024;

// Validate a virtual repository path before using it as a Git pathspec.
function resolveIn(issueId: string, path: string) {
  return { rel: repositoryPath(path) };
}

const inWorkspace = (issueId: string, args: string[], exit1Ok = false) =>
  git(["-C", workspacePath(issueId), ...args], undefined, { exit1Ok });

// A source-backed coordinator fact is usable only while the file it describes is
// unchanged. Paths go through the same workspace boundary checks as read_file.
export async function fingerprintWorkspaceFile(issueId: string, path: string) {
  return workspaceRequest<string | null>(issueId, "file", { operation: "fingerprint", path });
}

export async function workspaceWorkingDirectory(issueId: string, path = ".") {
  return workspaceRequest<string>(issueId, "file", { operation: "cwd", path });
}

// Includes tracked edits, deletions, binary changes, and non-ignored new files.
export async function workspaceRevision(issueId: string) {
  const [head, diff, untracked] = await Promise.all([
    inWorkspace(issueId, ["rev-parse", "HEAD"]),
    inWorkspace(issueId, ["diff", "HEAD", "--binary"]),
    inWorkspace(issueId, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const hash = createHash("sha256").update(head).update(diff);
  for (const path of untracked.split("\0").filter(Boolean).sort()) {
    hash.update(path).update("\0").update(await fingerprintWorkspaceFile(issueId, path) ?? "missing");
  }
  return hash.digest("hex");
}

export async function deleteWorkspaceFile(issueId: string, path: string) {
  return workspaceRequest<string>(issueId, "file", { operation: "delete", path });
}

// Moves or renames a file, creating the folders it goes in. Never replaces a file.
export async function moveWorkspaceFile(issueId: string, from: string, to: string) {
  return workspaceRequest<string>(issueId, "file", { operation: "move", path: from, to });
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
    const content = await workspaceRequest<string>(issueId, "file", { operation: "readText", path: file }).catch(() => "");
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

// Commits everything not committed yet (new files included, ignored ones not) as Zini.
export async function commitAll(issueId: string, message: string) {
  await inWorkspace(issueId, ["add", "-A"]);
  await inWorkspace(issueId, ["commit", "--quiet", "-m", message]);
}
