import { tool } from "langchain";
import { z } from "zod";
import { readWikiPage, searchWiki } from "./serving.js";

// Read tools over the repo's generated OpenWiki (architecture docs), served from a
// checkout of the default branch (see serving.ts). Model-free lookups:
// search builds an in-memory index per call. Orientation only: agents must verify
// everything in the actual code before acting.
export const searchWikiTool = tool(
  async ({ query, limit }) => {
    try {
      return await searchWiki(query, limit);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
  {
    name: "openwiki_search",
    description:
      "Search this repo's OpenWiki (generated architecture docs) for a question. Returns ranked page sections with excerpts. Use for orientation (where things live, how subsystems work); always verify in the actual code before acting.",
    schema: z.object({
      query: z.string().min(1).describe("The question or concept to look up in the wiki"),
      limit: z.number().int().min(1).max(20).optional().describe("Max results (default 5)"),
    }),
  },
);

export const readWikiTool = tool(
  async ({ page, sections }) => {
    try {
      return await readWikiPage(page, sections);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
  {
    name: "openwiki_read",
    description: "Read a full OpenWiki page or specific sections.",
    schema: z.object({
      page: z.string().describe('Wiki page path, e.g. "architecture.md"'),
      sections: z.array(z.string()).optional().describe("Section anchors to read; omit for the whole page"),
    }),
  },
);

export const wikiTools = [searchWikiTool, readWikiTool];
