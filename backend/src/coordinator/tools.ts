import { tool } from "langchain";
import { z } from "zod";
import {
  deleteWorkspaceFile,
  moveWorkspaceFile,
  workspaceChanges,
  workspaceDiff,
} from "../workspaceFiles.js";
import { git, workspacePath } from "../git.js";
import { checkedRepositoryPath, RepositoryFilesystemBackend, repositoryFilesystem } from "../repositoryFilesystem.js";

// The subagents' tools, each working in the issue's workspace.

// What the diff tool gives a model, at most.
const MAX_DIFF_FOR_MODEL = 60_000;

export function workspaceFilesystem(issueId: string, writable = false, notify?: () => void) {
  const root = workspacePath(issueId);
  return repositoryFilesystem(new RepositoryFilesystemBackend(root,
    (args, exit1Ok = false) => git(["-C", root, ...args], undefined, { exit1Ok }), writable, notify), writable);
}

// The files whose diffs start in a diff ("diff --git a/<path> b/<path>" lines).
const filesIn = (diff: string) =>
  new Set([...diff.matchAll(/^diff --git a\/(.+) b\/\1$/gm)].map((match) => match[1]));

// Without a path: the list of changed files, then the diff, cut between files once it
// passes MAX_DIFF_FOR_MODEL, with a note naming the files left out, so they can be
// asked for by path. With a path: just that file's (or folder's) diff. With
// uncommitted: only the changes since the last commit. Without tools: for a model that
// can't ask for the files left out (the committer, the PR writer), so the note only
// names them.
export async function diffForModel(
  issueId: string,
  path?: string,
  { uncommitted = false, tools = true } = {},
) {
  if (path) {
    const { diff } = await workspaceDiff(issueId, path);
    if (!diff) return `No changes in ${path}.`;
    return diff.length > MAX_DIFF_FOR_MODEL
      ? `${diff.slice(0, MAX_DIFF_FOR_MODEL)}\n[Cut off: read the file for the rest]`
      : diff;
  }

  const changes = await workspaceChanges(issueId, uncommitted);
  if (changes.length === 0) return "No changes.";
  const list = changes
    .map(({ path, added, removed, isNew }) => {
      const lines = added === "-" ? "binary" : `+${added} -${removed}`;
      return `${path} (${isNew ? "new, " : ""}${lines})`;
    })
    .join("\n");
  const { diff } = await workspaceDiff(issueId, "", uncommitted);
  if (diff.length <= MAX_DIFF_FOR_MODEL) return `Changed files:\n${list}\n\n${diff}`;

  // Cut before the first file that doesn't fit; if even the first doesn't, partway
  // through it.
  const end = diff.lastIndexOf("\ndiff --git ", MAX_DIFF_FOR_MODEL);
  const shown = end > 0 ? diff.slice(0, end + 1) : diff.slice(0, MAX_DIFF_FOR_MODEL);
  const shownFiles = filesIn(shown);
  const left = changes.filter((change) => !shownFiles.has(change.path)).map((change) => change.path);
  if (!tools) {
    const cut = end > 0 ? "" : "The first file is cut off. ";
    return `Changed files:\n${list}\n\n${shown}\n[The diff is too long to show. ${cut}Not shown: ${left.join(", ")}.]`;
  }
  const cut = end > 0 ? "" : "The first file is cut off: read it for the rest. ";
  return (
    `Changed files:\n${list}\n\n${shown}\n` +
    `[The diff is too long to show at once. ${cut}Not shown: ${left.join(", ")}. ` +
    "Call git_diff with the path of each.]"
  );
}

export const diffTool = (issueId: string) =>
  tool(async ({ path }) => diffForModel(issueId, path), {
    name: "git_diff",
    description:
      "Every change in the workspace since it branched, new files included: the list of " +
      "changed files, then a unified diff. A long diff is cut between files, with a note " +
      "naming the rest; pass a path for one file's (or folder's) diff.",
    schema: z.object({ path: z.string().optional() }),
  });

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
      changing(async ({ path }: { path: string }) =>
        deleteWorkspaceFile(issueId, await checkedRepositoryPath(workspacePath(issueId), path))),
      {
        name: "delete_file",
        description: "Delete a file.",
        schema: z.object({ path: z.string() }),
      },
    ),
    tool(
      changing(async ({ from, to }: { from: string; to: string }) =>
        moveWorkspaceFile(issueId, await checkedRepositoryPath(workspacePath(issueId), from),
          await checkedRepositoryPath(workspacePath(issueId), to))),
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
