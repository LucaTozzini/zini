import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";

type DockerStatus = { running: boolean; starting: boolean };
const dockerKey = ["docker"];

// Whether Docker is up on the machine running zini. Checked every 30 seconds, and
// every 5 while it's starting, so the webapp notices when it comes up or goes down.
export function useDocker() {
  return useQuery({
    queryKey: dockerKey,
    queryFn: () => api.get("docker", { timeout: 30000 }).json<DockerStatus>(),
    refetchInterval: (query) => (query.state.data?.starting ? 5000 : 30000),
  });
}

// Starts Docker Desktop on that machine; it then counts as starting until it's up.
export function useStartDocker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("docker/start", { timeout: 30000 }).json<DockerStatus>(),
    onSuccess: (data) => queryClient.setQueryData(dockerKey, data),
  });
}
