import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PullRequest, PullRequestStatus, Workspace, WorkspaceDiff } from 'shared'
import { api } from './client.ts'
import { coordinatorKey } from './coordinator.ts'

export const workspacesKey = ['workspaces']
export const workspaceKey = (issueId: string) => [...workspacesKey, issueId]

// The issue's workspace, or null if it doesn't have one yet.
export function useWorkspace(issueId: string) {
  return useQuery({
    queryKey: workspaceKey(issueId),
    queryFn: () => api.get(`workspaces/${issueId}`).json<Workspace | null>(),
  })
}

// Creating checks out a branch, which can take a while on a big repo, so no timeout.
export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) =>
      api.post('workspaces', { json: { issueId }, timeout: false }).json<Workspace>(),
    onSuccess: (workspace) => queryClient.setQueryData(workspaceKey(workspace.issueId), workspace),
  })
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) => api.delete(`workspaces/${issueId}`, { timeout: false }),
    onSuccess: (_res, issueId) => queryClient.setQueryData(workspaceKey(issueId), null),
  })
}

// Runs the setup command again; its outcome comes through useServerEvents.
export function useRerunSetup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) => api.post(`workspaces/${issueId}/setup`).json<Workspace>(),
    onSuccess: (workspace) => queryClient.setQueryData(workspaceKey(workspace.issueId), workspace),
  })
}

// The end of the workspace's last setup output, fetched while enabled (e.g. the log is
// open). Under the workspace's key, so it's refetched with it; every 2s while running.
export function useSetupLog(issueId: string, enabled: boolean, running: boolean) {
  return useQuery({
    queryKey: [...workspaceKey(issueId), 'setup-log'],
    queryFn: () => api.get(`workspaces/${issueId}/setup-log`).text(),
    enabled,
    refetchInterval: running ? 2000 : false,
  })
}

// The workspace's changes so far. Under the coordinator's key, so it's refetched with
// it, e.g. after every file the coder writes.
export function useWorkspaceDiff(issueId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...coordinatorKey(issueId), 'diff'],
    queryFn: () => api.get(`workspaces/${issueId}/diff`).json<WorkspaceDiff>(),
    enabled,
  })
}

// Commits the uncommitted changes with message (if any), then pushes the branch.
export function useCommitAndPush(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (message: string) =>
      api.post(`workspaces/${issueId}/commit`, { json: { message }, timeout: false }).json<Workspace>(),
    onSuccess: (workspace) => queryClient.setQueryData(workspaceKey(issueId), workspace),
  })
}

const pullRequestKey = (issueId: string) => [...workspaceKey(issueId), 'pull-request']

// Whether the branch is on GitHub, and its pull request, fetched while enabled (e.g.
// everything is pushed). Under the workspace's key, so a push refetches it.
export function usePullRequest(issueId: string, enabled: boolean) {
  return useQuery({
    queryKey: pullRequestKey(issueId),
    queryFn: () => api.get(`workspaces/${issueId}/pull-request`).json<PullRequestStatus>(),
    enabled,
  })
}

// Opens the pull request, which then shows in place of the form.
export function useOpenPullRequest(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pull: { title: string; body: string }) =>
      api.post(`workspaces/${issueId}/pull-request`, { json: pull, timeout: false }).json<PullRequest>(),
    onSuccess: (pullRequest) =>
      queryClient.setQueryData<PullRequestStatus>(pullRequestKey(issueId), { pushed: true, pullRequest }),
  })
}
