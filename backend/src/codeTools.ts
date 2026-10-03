import { createMiddleware, tool, ToolMessage } from "langchain";
import { z } from "zod";
import { fetchRepo, listRepoFiles, readRepoFile, searchRepoCode } from "./git.js";

// Read-only tools over the repo's default branch. Fetching is left to fetchRepoMiddleware.
export const codeTools = [
  tool(async ({ path }) => listRepoFiles(path ?? ""), {
    name: "list_files",
    description: "List a folder's files and subfolders (subfolders end in /). Omit path for the root.",
    schema: z.object({ path: z.string().optional().describe('e.g. "src/components"') }),
  }),
  tool(async ({ path, startLine, endLine }) => readRepoFile(path, startLine, endLine), {
    name: "read_file",
    description:
      "Read a file, with line numbers. Long files are cut off with a note saying which " +
      "startLine to read on from; pass a line range to read just part of a file.",
    schema: z.object({
      path: z.string().describe('e.g. "src/App.tsx"'),
      startLine: z.number().int().min(1).optional().describe("First line to read, from 1"),
      endLine: z.number().int().min(1).optional().describe("Last line to read, inclusive"),
    }),
  }),
  tool(async ({ query, regex }) => searchRepoCode(query, regex), {
    name: "search_code",
    description:
      "Find lines containing some text (plain text, any case), as path:line:text. " +
      "Set regex to search with an extended regex instead, e.g. to match any of " +
      'several terms ("useEffect|useMemo"). Up to 100 matches; use a more specific ' +
      "term if there are more. Lockfiles (package-lock.json, yarn.lock, ...) aren't " +
      "searched: see package.json for dependencies, or read the lockfile itself.",
    schema: z.object({
      query: z.string().min(1),
      regex: z.boolean().optional().describe("Treat query as an extended regex (default: plain text)"),
    }),
  }),
];
const CODE_TOOL_NAMES = new Set<string>(codeTools.map((t) => t.name));

// Brings the clone up to date before each code tool runs; other tools pass straight
// through. Parallel code tools share one fetch (see fetchRepo). If the fetch fails,
// the tool doesn't run on stale code: the model gets the error as its result.
export const fetchRepoMiddleware = createMiddleware({
  name: "FetchRepo",
  wrapToolCall: async (request, handler) => {
    if (!CODE_TOOL_NAMES.has(request.toolCall.name)) return handler(request);
    try {
      await fetchRepo();
    } catch (err) {
      console.error("Fetching the repo failed:", err);
      // A failed git command's message ends with its "fatal: ..." line.
      const reason = err instanceof Error ? err.message.trim().split("\n").at(-1) : String(err);
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? "",
        name: request.toolCall.name,
        status: "error",
        content: `Couldn't update the code from GitHub: ${reason}. Tell the user.`,
      });
    }
    return handler(request);
  },
});
