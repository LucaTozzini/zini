import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";
import { projectApiPath } from "../hooks/useProject.ts";
type Status = { variables: { name: string; configured: boolean }[] };
type Change = { name: string; value: string } | { name: string; remove: true };
// The project's development variables, by name: values never come back.
export function useDevelopmentEnvironment(projectId: number) {
  return useQuery({
    queryKey: ["development-environment", projectId],
    queryFn: () => api.get(projectApiPath(projectId, "development-environment")).json<Status>(),
  });
}
export function useSaveDevelopmentEnvironment(projectId: number) {
  const client = useQueryClient();
  const path = projectApiPath(projectId, "development-environment");
  return useMutation({
    mutationFn: (input: { variables: Change[] } | { content: string }) =>
      "content" in input
        ? api.post(`${path}/import`, { json: input }).json<Status>()
        : api.put(path, { json: input }).json<Status>(),
    onSuccess: (status) => client.setQueryData(["development-environment", projectId], status),
  });
}
