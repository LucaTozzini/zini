import { useQuery } from "@tanstack/react-query";
import type { DatabaseSchema } from "shared";
import { api } from "./client.ts";

export const databaseSchemaKey = ["database", "schema"];

// The connected Postgres database's tables and foreign keys. Only fetched while a
// database is connected (enabled), since the backend 404s otherwise.
export function useDatabaseSchema(enabled: boolean) {
  return useQuery({
    queryKey: databaseSchemaKey,
    queryFn: () => api.get("database/schema").json<DatabaseSchema>(),
    enabled,
  });
}
