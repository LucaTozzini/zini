import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Integrations,
  LinearIssue,
  LinearIssueDetails,
  ProjectProvider,
  Provider,
  SharedProvider,
  StatusType,
} from "shared";
import { api } from "./client.ts";
import { projectApiPath, useProjectId } from "../hooks/useProject.ts";

const integrationsKey = ["integrations"];
const linearIssuesKey = ["linear", "issues"];

// Where a set of keys lives: the shared ones, or a project's.
const integrationsPath = (projectId?: number) =>
  projectId === undefined ? "integrations" : projectApiPath(projectId, "integrations");
const keyFor = (projectId?: number) => (projectId === undefined ? integrationsKey : [...integrationsKey, projectId]);

// Which shared services are connected. Keys are tested when saved, not here.
export function useIntegrations() {
  return useQuery({
    queryKey: integrationsKey,
    queryFn: () => api.get("integrations").json<Integrations>(),
  });
}

// Which of the project's services are connected.
export function useProjectIntegrations(projectId: number) {
  return useQuery({
    queryKey: keyFor(projectId),
    queryFn: () => api.get(integrationsPath(projectId)).json<Integrations<ProjectProvider>>(),
  });
}

// The shared services' statuses, or with projectId, the project's.
export function useIntegrationStatus(projectId?: number) {
  return useQuery({
    queryKey: keyFor(projectId),
    queryFn: () => api.get(integrationsPath(projectId)).json<Integrations | Integrations<ProjectProvider>>(),
  });
}

// Saves a key: a shared service's, or with projectId, the project's.
export function useConnectIntegration(provider: Provider, projectId?: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => api.put(integrationsPath(projectId), { json: { [provider]: apiKey } }).json(),
    onSuccess: (data) => {
      queryClient.setQueryData(keyFor(projectId), data);
      // A new Linear key can see different issues.
      if (provider === ("linear" satisfies SharedProvider)) queryClient.invalidateQueries({ queryKey: ["linear"] });
    },
  });
}

export function useDisconnectIntegration(provider: Provider, projectId?: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`${integrationsPath(projectId)}/${provider}`).json(),
    onSuccess: (data) => queryClient.setQueryData(keyFor(projectId), data),
  });
}

// The project's team's issues with one of the statuses.
export function useLinearIssues(statuses: StatusType[]) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: [...linearIssuesKey, projectId, statuses],
    queryFn: () =>
      api
        .get(projectApiPath(projectId, "linear/issues"), { searchParams: { status: statuses.join(",") } })
        .json<{ issues: LinearIssue[] }>()
        .then((res) => res.issues),
  });
}

// One issue with its details, by identifier (e.g. ZIN-4) or id.
export function useLinearIssue(id: string) {
  return useQuery({
    queryKey: ["linear", "issue", id],
    queryFn: () => api.get(`linear/issues/${id}`).json<LinearIssueDetails>(),
  });
}
