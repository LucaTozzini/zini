import { tool } from "langchain";
import { z } from "zod";
import {
  deleteWorkspaceFile,
  editWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  searchWorkspace,
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

export const diffTool = (issueId: string) =>
  tool(
    async () => {
      const { diff } = await workspaceDiff(issueId);
      if (!diff) return "No changes.";
      return diff.length > MAX_DIFF_FOR_MODEL
        ? `${diff.slice(0, MAX_DIFF_FOR_MODEL)}\n[Cut off: read the files for the rest]`
        : diff;
    },
    {
      name: "git_diff",
      description:
        "Every change in the workspace since it branched, new files included, as a unified diff.",
      schema: z.object({}),
    },
  );

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
