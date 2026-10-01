import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PipelineResume, PipelineState, RunLogEvent, RunLogSummary } from 'shared'
import { api } from './client.ts'

export const coordinatorKey = (issueId: string) => ['coordinator', issueId]

// The issue's coordinator pipeline (one per issue). Its progress comes through
// useServerEvents, which refetches it (and the workspace diff) on coordinator.updated.
export function useCoordinator(issueId: string) {
  return useQuery({
    queryKey: coordinatorKey(issueId),
    queryFn: () => api.get(`coordinator/${issueId}`).json<PipelineState>(),
  })
}

export const runLogsKey = (issueId: string) => [...coordinatorKey(issueId), 'logs']

// The issue's subagent runs, oldest first, kept up to date by useServerEvents.
export function useRunLogs(issueId: string) {
  return useQuery({
    queryKey: runLogsKey(issueId),
    queryFn: () => api.get(`coordinator/${issueId}/logs`).json<RunLogSummary[]>(),
  })
}

// One run's log, fetched while enabled (e.g. its section is open); refetched on each
// line added.
export function useRunLog(issueId: string, runId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...runLogsKey(issueId), runId],
    queryFn: () => api.get(`coordinator/${issueId}/logs/${runId}`).json<RunLogEvent[]>(),
    enabled,
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
