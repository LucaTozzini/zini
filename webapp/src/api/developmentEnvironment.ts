import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";
type Status = { repository: string | null; variables: { name: string; configured: boolean }[] };
type Change = { name: string; value: string } | { name: string; remove: true };
export function useDevelopmentEnvironment(repository: string) {
  return useQuery({
    queryKey: ["development-environment", repository],
    queryFn: () => api.get("settings/development-environment", { searchParams: { repository } }).json<Status>(),
    enabled: Boolean(repository),
  });
}
export function useSaveDevelopmentEnvironment(repository: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { variables: Change[] } | { content: string }) =>
      "content" in input
        ? api.post("settings/development-environment/import", { json: { repository, ...input } }).json<Status>()
        : api.put("settings/development-environment", { json: { repository, ...input } }).json<Status>(),
    onSuccess: (status) => client.setQueryData(["development-environment", repository], status),
  });
}
