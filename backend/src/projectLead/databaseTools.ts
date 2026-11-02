import { tool } from "langchain";
import { z } from "zod";
import { getProjectKey } from "../models/ProjectIntegration.js";
import { describeDatabase, MAX_ROWS, readOnlyQuery } from "../integrations/postgres.js";

// Read-only access to the user's production database, when it's connected in the project's settings.
// The connection string is read per call, so a new one applies straight away.
const database = async (projectId: number) => {
  const url = await getProjectKey(projectId, "postgres");
  if (!url) throw new Error("No production Postgres database is connected. The user can connect one in the project's settings.");
  return url;
};

export const databaseTools = (projectId: number) => [
  tool(async () => JSON.stringify(await describeDatabase(await database(projectId))), {
    name: "describe_database",
    description:
      "List the production PostgreSQL database's tables and views, each with its columns and their " +
      "types. Use it before query_database to find the right tables and column names.",
    schema: z.object({}),
  }),
  tool(async ({ sql }) => JSON.stringify(await readOnlyQuery(await database(projectId), sql)), {
    name: "query_database",
    description:
      "Run one read-only SQL statement on the production PostgreSQL database, e.g. to " +
      "check real data while investigating a bug or sizing a change. Writes are refused. " +
      `Returns the columns and up to ${MAX_ROWS} rows, with truncated: true when there ` +
      "were more; long values are cut. Statements time out after 15 seconds, so filter and " +
      "aggregate in SQL rather than reading whole tables. This is real user data: only " +
      "query what the task needs, and don't copy personal data into issues.",
    schema: z.object({ sql: z.string().trim().min(1).describe("One SQL statement, e.g. a SELECT") }),
  }),
];
