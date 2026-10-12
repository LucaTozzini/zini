import { createHash } from "node:crypto";
import type { WorkspaceDiff } from "shared";
import { git, workspacePath } from "../repositories/git.js";
import { workspaceRequest } from "./workspaceSandbox.js";
import { workspaceGitOperation } from "./workspaceVolumes.js";
import { repositoryPath } from "../repositories/repositoryFilesystem.js";

// The files of an issue's workspace, as the pipeline's subagents see and change them:
// the checkout in a Linux Docker volume, uncommitted edits included. Content I/O goes
// through the gateway; trusted Git uses a reusable helper container on the same volume.

const inWorkspace = (issueId: string, args: string[], exit1Ok = false) =>
  git(["-C", workspacePath(issueId), ...args], undefined, { exit1Ok });

// A source-backed forge fact is usable only while the file it describes is
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

type Change = { path: string; added: string; removed: string; isNew: boolean };

// Collect the summary and patch in the same frozen snapshot and helper invocation.
export async function workspaceDiffSnapshot(issueId: string, path = "", uncommitted = false, summary = true, patch = true) {
  const rel = path ? repositoryPath(path) : "";
  return workspaceGitOperation<WorkspaceDiff & { changes: Change[] }>(issueId, { operation: "diff", path: rel, uncommitted, summary, patch });
}

export async function workspaceDiff(issueId: string, path = "", uncommitted = false): Promise<WorkspaceDiff> {
  const { diff, truncated } = await workspaceDiffSnapshot(issueId, path, uncommitted, false);
  return { diff, truncated };
}

export async function workspaceChanges(issueId: string, uncommitted = false) {
  return (await workspaceDiffSnapshot(issueId, "", uncommitted, true, false)).changes;
}

// ---- Committing ----------------------------------------------------------------------

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
