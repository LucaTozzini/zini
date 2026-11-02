import { useQuery } from "@tanstack/react-query";
import type { DatabaseSchema } from "shared";
import { api } from "./client.ts";
import { projectApiPath, useProjectId } from "../hooks/useProject.ts";

export const databaseSchemaKey = ["database", "schema"];

// The project's connected Postgres database's tables and foreign keys. Only fetched
// while a database is connected (enabled), since the backend 404s otherwise.
export function useDatabaseSchema(enabled: boolean) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: [...databaseSchemaKey, projectId],
    queryFn: () => api.get(projectApiPath(projectId, "database/schema")).json<DatabaseSchema>(),
    enabled,
  });
}
