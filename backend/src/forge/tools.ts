import { tool } from "langchain";
import { z } from "zod";
import {
  deleteWorkspaceFile,
  moveWorkspaceFile,
  workspaceChanges,
  workspaceDiffSnapshot,
  workspaceDiff,
} from "../workspaces/workspaceFiles.js";
import { repositoryFilesystem } from "../repositories/repositoryFilesystem.js";
import { containerFilesystem } from "../workspaces/containerFilesystem.js";
import { inspectConflicts, resolveConflict } from "../workspaces/workspaceIntegration.js";

// The subagents' tools, each working in the issue's workspace.

// What the diff tool gives a model, at most.
const MAX_DIFF_FOR_MODEL = 60_000;

export function workspaceFilesystem(issueId: string, writable = false, notify?: () => void) {
  return repositoryFilesystem(containerFilesystem(issueId, writable, notify), writable);
}

// The files whose diffs start in a diff ("diff --git a/<path> b/<path>" lines).
const filesIn = (diff: string) => new Set([...diff.matchAll(/^diff --git a\/(.+) b\/\1$/gm)].map((match) => match[1]));

const changeList = (changes: Awaited<ReturnType<typeof workspaceChanges>>) =>
  changes
    .map(({ path, added, removed, isNew }) => {
      const lines = added === "-" ? "binary" : `+${added} -${removed}`;
      return `${path} (${isNew ? "new, " : ""}${lines})`;
    })
    .join("\n");

// Without a path: the list of changed files, then the diff, cut between files once it
// passes MAX_DIFF_FOR_MODEL, with a note naming the files left out, so they can be
// asked for by path. With a path: just that file's (or folder's) diff. With
// uncommitted: only the changes since the last commit.
export async function diffForModel(issueId: string, path?: string, { uncommitted = false } = {}) {
  if (path) {
    const { diff } = await workspaceDiff(issueId, path);
    if (!diff) return `No changes in ${path}.`;
    return diff.length > MAX_DIFF_FOR_MODEL
      ? `${diff.slice(0, MAX_DIFF_FOR_MODEL)}\n[Cut off: read the file for the rest]`
      : diff;
  }

  const { changes, diff } = await workspaceDiffSnapshot(issueId, "", uncommitted);
  if (changes.length === 0) return "No changes.";
  const list = changeList(changes);
  if (diff.length <= MAX_DIFF_FOR_MODEL) return `Changed files:\n${list}\n\n${diff}`;

  // Cut before the first file that doesn't fit; if even the first doesn't, partway
  // through it.
  const end = diff.lastIndexOf("\ndiff --git ", MAX_DIFF_FOR_MODEL);
  const shown = end > 0 ? diff.slice(0, end + 1) : diff.slice(0, MAX_DIFF_FOR_MODEL);
  const shownFiles = filesIn(shown);
  const left = changes.filter((change) => !shownFiles.has(change.path)).map((change) => change.path);
  const cut = end > 0 ? "" : "The first file is cut off: read it for the rest. ";
  return (
    `Changed files:\n${list}\n\n${shown}\n` +
    `[The diff is too long to show at once. ${cut}Not shown: ${left.join(", ")}. ` +
    "Call git_diff with the path of each.]"
  );
}

// The subagents' git_diff: without a path, only the list of changed files, so they ask
// for the diffs they need by path instead of carrying the whole patch in every call.
export const diffTool = (issueId: string) =>
  tool(
    async ({ path }) => {
      if (path) return diffForModel(issueId, path);
      const changes = await workspaceChanges(issueId);
      return changes.length ? `Changed files:\n${changeList(changes)}` : "No changes.";
    },
    {
      name: "git_diff",
      description:
        "Every change in the workspace since it branched (during a merge, compared with the " +
        "branch being merged in), new files included. Without a path: the list of changed " +
        "files with their added/removed line counts. With a path: that file's (or folder's) " +
        "unified diff.",
      schema: z.object({ path: z.string().optional() }),
    },
  );

export function conflictTools(issueId: string, writable = false) {
  return [
    tool(
      async ({ path }) => (path ? inspectConflicts(issueId, path) : (await inspectConflicts(issueId)).map((file) => file.path)),
      {
        name: "inspect_conflicts",
        description:
          "Inspect unresolved conflict paths and base/ours/theirs contents. Deleted and binary sides are explicit. Pass one path for full per-file context.",
        schema: z.object({ path: z.string().optional() }),
      },
    ),
    ...(writable
      ? [
          tool(({ path }) => resolveConflict(issueId, path), {
            name: "resolve_conflict",
            description:
              "After editing a conflicted file (or deleting it), record its resolution. All conflict markers must be removed. Infrastructure completes the merge after submission.",
            schema: z.object({ path: z.string() }),
          }),
        ]
      : []),
  ];
}

// notify runs after each change, so the webapp's diff follows the coder's work.
export function writeTools(issueId: string, notify: () => void) {
  const changing =
    <T>(change: (input: T) => Promise<string>) =>
    async (input: T) => {
      const result = await change(input);
      notify();
      return result;
    };
  return [
    tool(
      changing(async ({ path }: { path: string }) => deleteWorkspaceFile(issueId, path)),
      {
        name: "delete_file",
        description: "Delete a file.",
        schema: z.object({ path: z.string() }),
      },
    ),
    tool(
      changing(async ({ from, to }: { from: string; to: string }) => moveWorkspaceFile(issueId, from, to)),
      {
        name: "move_file",
        description:
          "Move or rename a file, as it is, creating the folders it goes in. Fails if " +
          "to already exists. Update what refers to the old path (e.g. imports) " +
          "yourself: grep finds it.",
        schema: z.object({ from: z.string(), to: z.string() }),
      },
    ),
  ];
}
