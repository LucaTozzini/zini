import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PullRequest,
  PullRequestStatus,
  Workspace,
  WorkspaceDiff,
  WorkspaceSelection,
  WorkspaceGitStatus,
  WorkspaceAppState,
} from "shared";
import { api } from "./client.ts";
import { forgeKey } from "./forge.ts";

export const workspacesKey = ["workspaces"];
export const workspaceKey = (issueId: string) => [...workspacesKey, issueId];

// The issue's workspace, or null if it doesn't have one yet. issueId is the issue's id (not
// its identifier, e.g. ENG-123); nothing is fetched until it's known.
export function useWorkspace(issueId: string | undefined) {
  return useQuery({
    queryKey: workspaceKey(issueId ?? ""),
    queryFn: () => api.get(`workspaces/${issueId}`).json<Workspace | null>(),
    enabled: Boolean(issueId),
    retry: false,
  });
}

// Only mounted by commit/push and PR controls, independent of workspace metadata.
export function useWorkspaceGitStatus(issueId: string) {
  return useQuery({
    queryKey: [...workspaceKey(issueId), "git-status"],
    queryFn: () => api.get(`workspaces/${issueId}/git-status`, { timeout: 60000 }).json<WorkspaceGitStatus | null>(),
    retry: false,
  });
}

// Creating checks out a branch, which can take a while on a big repo, so no timeout.
export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: string | ({ issueId: string } & WorkspaceSelection)) =>
      api.post("workspaces", { json: typeof input === "string" ? { issueId: input } : input, timeout: false }).json<Workspace>(),
    onSuccess: (workspace) => queryClient.setQueryData(workspaceKey(workspace.issueId), workspace),
  });
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string) => api.delete(`workspaces/${issueId}`, { timeout: false }),
    onSuccess: (_res, issueId) => queryClient.setQueryData(workspaceKey(issueId), null),
  });
}

// The workspace's changes so far. Under the forge's key, so it's refetched with
// it, e.g. after every file the coder writes.
export function useWorkspaceDiff(issueId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...forgeKey(issueId), "diff"],
    queryFn: () => api.get(`workspaces/${issueId}/diff`).json<WorkspaceDiff>(),
    enabled,
  });
}

// Commits the uncommitted changes with message (if any), then pushes the branch.
export function useCommitAndPush(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) =>
      api.post(`workspaces/${issueId}/commit`, { json: { message }, timeout: false }).json<Workspace>(),
    onSuccess: (workspace) => {
      queryClient.setQueryData(workspaceKey(issueId), workspace);
      queryClient.invalidateQueries({ queryKey: [...workspaceKey(issueId), "git-status"] });
    },
  });
}

const pullRequestKey = (issueId: string) => [...workspaceKey(issueId), "pull-request"];

// Whether the branch is on GitHub, and its pull request, fetched while enabled (e.g.
// everything is pushed). Under the workspace's key, so a push refetches it.
export function usePullRequest(issueId: string, enabled: boolean) {
  return useQuery({
    queryKey: pullRequestKey(issueId),
    queryFn: () => api.get(`workspaces/${issueId}/pull-request`).json<PullRequestStatus>(),
    enabled,
  });
}

// Opens the pull request, which then shows in place of the form.
export function useOpenPullRequest(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pull: { title: string; body: string }) =>
      api.post(`workspaces/${issueId}/pull-request`, { json: pull, timeout: false }).json<PullRequest>(),
    onSuccess: (pullRequest) =>
      queryClient.setQueryData<PullRequestStatus>(pullRequestKey(issueId), { pushed: true, pullRequest }),
  });
}

// The user's app in the workspace, for its preview page. Polled while it isn't ready,
// since it's started in the background, and the Project Lead starts and stops it too.
export function useWorkspaceApp(issueId: string) {
  return useQuery({
    queryKey: [...workspaceKey(issueId), "app"],
    queryFn: () => api.get(`workspaces/${issueId}/app`).json<WorkspaceAppState>(),
    refetchInterval: (query) => (query.state.data?.status === "ready" ? 15000 : 3000),
  });
}

// Starts the app from its preview page (with the Project Lead's launcher), or stops it.
export function useWorkspaceAppControl(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: "start" | "stop") => api.post(`workspaces/${issueId}/app/${action}`, { timeout: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...workspaceKey(issueId), "app"] }),
  });
}
