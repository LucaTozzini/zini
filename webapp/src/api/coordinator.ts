import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CoordinatorMessage, PendingApproval, PipelineResume, PipelineState } from 'shared'
import { api } from './client.ts'

export const coordinatorKey = (issueId: string) => ['coordinator', issueId]
export const coordinatorMessagesKey = (issueId: string) => [...coordinatorKey(issueId), 'messages']

export function useCoordinatorMessages(issueId: string) {
  return useQuery({
    queryKey: coordinatorMessagesKey(issueId),
    queryFn: () => api.get(`coordinator/${issueId}/messages`).json<CoordinatorMessage[]>(),
  })
}

// The issue's coordinator pipeline (one per issue). Its progress comes through
// useServerEvents, which refetches it (and the workspace diff) on coordinator.updated.
export function useCoordinator(issueId: string) {
  return useQuery({
    queryKey: coordinatorKey(issueId),
    queryFn: () => api.get(`coordinator/${issueId}`).json<PipelineState>(),
  })
}

// Under ['coordinator'] like the pipelines, so reconnecting refetches it with them.
export const approvalsKey = ['coordinator', 'approvals']

// The issues whose pipeline is waiting for an approval; refetched by useServerEvents
// whenever a pipeline changes.
export function usePendingApprovals() {
  return useQuery({
    queryKey: approvalsKey,
    queryFn: () => api.get('coordinator/approvals').json<PendingApproval[]>(),
  })
}

// Starting and replying answer once the run has started; refetching then shows it.
export function useStartPipeline(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (note: string) => api.post(`coordinator/${issueId}/start`, { json: { note } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: coordinatorKey(issueId) }),
  })
}

// Replies to what the pipeline is waiting on: answers, approving the plan, or feedback.
export function useResumePipeline(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reply: PipelineResume) => api.post(`coordinator/${issueId}/resume`, { json: reply }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: coordinatorKey(issueId) }),
  })
}

export function usePipelineControl(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: 'pause' | 'continue') => api.post(`coordinator/${issueId}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: coordinatorKey(issueId) }),
  })
}

// Writes a commit message for the workspace's uncommitted changes; a model call, so no
// timeout.
export function useWriteCommitMessage(issueId: string) {
  return useMutation({
    mutationFn: () =>
      api
        .post(`coordinator/${issueId}/commit-message`, { timeout: false })
        .json<{ commitMessage: string }>(),
  })
}

// Writes a pull request's title and body for the branch; a model call, so no timeout.
export function useWritePullRequest(issueId: string) {
  return useMutation({
    mutationFn: () =>
      api
        .post(`coordinator/${issueId}/pull-request-text`, { timeout: false })
        .json<{ title: string; body: string }>(),
  })
}
