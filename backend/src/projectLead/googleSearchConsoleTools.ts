import { tool } from "langchain";
import { z } from "zod";
import { Project } from "../models/Project.js";
import { getProjectKey } from "../models/ProjectIntegration.js";
import { DIMENSIONS, MAX_ROWS, OPERATORS, queryGoogleSearchConsole, SEARCH_TYPES } from "../integrations/googleSearchConsole.js";

// The project's site's search performance in Google Search Console, when it's connected in
// the project's settings. The key and property are read per call, so new ones apply straight away.
const searchConsole = async (projectId: number) => {
  const [key, project] = await Promise.all([getProjectKey(projectId, "googleSearchConsole"), Project.findByPk(projectId)]);
  const site = project?.googleSearchConsoleSite;
  if (!key || !site) throw new Error("Google Search Console isn't connected. The user can connect it in the project's settings.");
  return { key, site };
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date as YYYY-MM-DD");

export const googleSearchConsoleTools = (projectId: number) => [
  tool(
    async (args) => {
      const { key, site } = await searchConsole(projectId);
      return JSON.stringify(await queryGoogleSearchConsole(key, site, args));
    },
    {
      name: "query_google_search_console",
      description:
        "Get the project's site's Google Search performance from Google Search Console: " +
        "clicks, impressions, CTR (0 to 1) and average position, from startDate to endDate " +
        "(the last 28 days by default; data is 2-3 days behind and kept for 16 months). " +
        "dimensions group the rows, e.g. [query] for the top searches, [page] for the top " +
        "pages, [date] for a trend; with none, one row of totals. filters narrow them, e.g. " +
        "page contains /blog/ or query includingRegex pricing. Rows come by clicks, most " +
        `first (by date when grouped by date), up to rowLimit (100 by default, ${MAX_ROWS} at ` +
        "most); truncated: true means there may be more, from startRow.",
      schema: z.object({
        startDate: date.optional().describe("First day, YYYY-MM-DD"),
        endDate: date.optional().describe("Last day, YYYY-MM-DD; today by default"),
        dimensions: z.array(z.enum(DIMENSIONS)).optional().describe("What to group the rows by"),
        filters: z
          .array(
            z.object({
              dimension: z.enum(DIMENSIONS),
              operator: z.enum(OPERATORS),
              expression: z.string().min(1).describe("The value, or a regex for the regex operators"),
            }),
          )
          .optional()
          .describe("Rows must match all of these"),
        type: z.enum(SEARCH_TYPES).optional().describe("Which results: web by default"),
        rowLimit: z.number().int().min(1).max(MAX_ROWS).optional(),
        startRow: z.number().int().min(0).optional().describe("Row to start from, to page on"),
      }),
    },
  ),
];
