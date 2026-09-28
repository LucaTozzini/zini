import { tool } from "langchain";
import { z } from "zod";
import {
  deleteWorkspaceFile,
  editWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  searchWorkspace,
  workspaceChanges,
  workspaceDiff,
  writeWorkspaceFile,
} from "../workspaceFiles.js";

// The subagents' tools, each working in the issue's workspace.

// What the diff tool gives a model, at most.
const MAX_DIFF_FOR_MODEL = 60_000;

export function readTools(issueId: string) {
  return [
    tool(async ({ path }) => listWorkspaceFiles(issueId, path ?? ""), {
      name: "list_files",
      description:
        "List a folder's files and subfolders (subfolders end in /). Omit path for the root.",
      schema: z.object({ path: z.string().optional() }),
    }),
    tool(
      async ({ path, startLine, endLine }) =>
        readWorkspaceFile(issueId, path, startLine, endLine),
      {
        name: "read_file",
        description:
          "Read a file, with line numbers. Long files are cut off with a note saying which " +
          "startLine to read on from; pass a line range to read just part of a file.",
        schema: z.object({
          path: z.string(),
          startLine: z.number().int().min(1).optional(),
          endLine: z.number().int().min(1).optional(),
        }),
      },
    ),
    tool(async ({ query }) => searchWorkspace(issueId, query), {
      name: "search_code",
      description:
        "Find lines containing some text (plain text, any case), as path:line:text.",
      schema: z.object({ query: z.string().min(1) }),
    }),
  ];
}

// The files whose diffs start in a diff ("diff --git a/<path> b/<path>" lines).
const filesIn = (diff: string) =>
  new Set([...diff.matchAll(/^diff --git a\/(.+) b\/\1$/gm)].map((match) => match[1]));

// Without a path: the list of changed files, then the diff, cut between files once it
// passes MAX_DIFF_FOR_MODEL, with a note naming the files left out, so they can be
// asked for by path. With a path: just that file's (or folder's) diff.
async function diffForModel(issueId: string, path?: string) {
  if (path) {
    const { diff } = await workspaceDiff(issueId, path);
    if (!diff) return `No changes in ${path}.`;
    return diff.length > MAX_DIFF_FOR_MODEL
      ? `${diff.slice(0, MAX_DIFF_FOR_MODEL)}\n[Cut off: read the file for the rest]`
      : diff;
  }

  const changes = await workspaceChanges(issueId);
  if (changes.length === 0) return "No changes.";
  const list = changes
    .map(({ path, added, removed, isNew }) => {
      const lines = added === "-" ? "binary" : `+${added} -${removed}`;
      return `${path} (${isNew ? "new, " : ""}${lines})`;
    })
    .join("\n");
  const { diff } = await workspaceDiff(issueId);
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
      changing(({ path, content }: { path: string; content: string }) =>
        writeWorkspaceFile(issueId, path, content),
      ),
      {
        name: "write_file",
        description: "Create a file, or replace a whole file, with content.",
        schema: z.object({ path: z.string(), content: z.string() }),
      },
    ),
    tool(
      changing(
        ({
          path,
          oldText,
          newText,
        }: {
          path: string;
          oldText: string;
          newText: string;
        }) => editWorkspaceFile(issueId, path, oldText, newText),
      ),
      {
        name: "edit_file",
        description:
          "Replace oldText with newText in a file. oldText must appear exactly once: copy it " +
          "from read_file (without line numbers), with enough lines to be unique.",
        schema: z.object({
          path: z.string(),
          oldText: z.string().min(1),
          newText: z.string(),
        }),
      },
    ),
    tool(
      changing(({ path }: { path: string }) =>
        deleteWorkspaceFile(issueId, path),
      ),
      {
        name: "delete_file",
        description: "Delete a file.",
        schema: z.object({ path: z.string() }),
      },
    ),
  ];
}
