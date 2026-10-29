import { tool } from "langchain";
import { z } from "zod";
import { getKey } from "../models/Integration.js";
import { MAX_EVENTS, searchLogs } from "../integrations/papertrail.js";

// Searching the production app's logs in Papertrail, when it's connected in Settings. The
// token is read per call, so a new one applies straight away.
const papertrailToken = async () => {
  const token = await getKey("papertrail");
  if (!token) throw new Error("Papertrail isn't connected. The user can connect it in Settings.");
  return token;
};

export const logTools = [
  tool(async (args) => JSON.stringify(await searchLogs(await papertrailToken(), args)), {
    name: "search_logs",
    description:
      "Search the production app's logs in Papertrail, e.g. to find the errors behind a bug " +
      "report or check what happened around a time. query is a search, e.g. error or " +
      '"status=500"; every line if empty. from and to bound the time (ISO), the last hour by ' +
      `default; logs are only kept for a few days. Returns up to ${MAX_EVENTS} matching lines, ` +
      "newest first, each with its time, system, program (e.g. app/web.1, heroku/router), " +
      "severity and message (long ones cut). When there are older ones, nextPage is the page " +
      "to pass back for them. No lines but a nextPage means the search hasn't reached any " +
      "matches yet, not that there are none: page on, or narrow the window. Logs can hold " +
      "personal data: only search what the task needs.",
    schema: z.object({
      query: z.string().trim().optional().describe("A search, e.g. error; every line if empty"),
      from: z.string().trim().optional().describe("Oldest time, ISO, e.g. 2026-10-29T13:00:00Z"),
      to: z.string().trim().optional().describe("Newest time, ISO; now by default"),
      page: z.string().trim().optional().describe("A previous search's nextPage, for its older lines"),
    }),
  }),
];
