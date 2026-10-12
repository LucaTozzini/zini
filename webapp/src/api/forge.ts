import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ForgeMessage, PendingApproval, PipelineRedirect, PipelineResume, PipelineState } from 'shared'
import { api } from './client.ts'

export const forgeKey = (issueId: string) => ['forge', issueId]
export const forgeMessagesKey = (issueId: string) => [...forgeKey(issueId), 'messages']

export function useForgeMessages(issueId: string) {
  return useQuery({
    queryKey: forgeMessagesKey(issueId),
    queryFn: () => api.get(`forge/${issueId}/messages`).json<ForgeMessage[]>(),
  })
}

// The issue's forge pipeline (one per issue). Its progress comes through
// useServerEvents, which refetches it (and the workspace diff) on forge.updated.
export function useForge(issueId: string) {
  return useQuery({
    queryKey: forgeKey(issueId),
    queryFn: () => api.get(`forge/${issueId}`).json<PipelineState>(),
  })
}

// Under ['forge'] like the pipelines, so reconnecting refetches it with them.
export const approvalsKey = ['forge', 'approvals']

// The issues whose pipeline is waiting for an approval; refetched by useServerEvents
// whenever a pipeline changes.
export function usePendingApprovals() {
  return useQuery({
    queryKey: approvalsKey,
    queryFn: () => api.get('forge/approvals').json<PendingApproval[]>(),
  })
}

// Starting and replying answer once the run has started; refetching then shows it.
export function useStartPipeline(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (note: string) => api.post(`forge/${issueId}/start`, { json: { note } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: forgeKey(issueId) }),
  })
}

// Replies to what the pipeline is waiting on: answers, approving the plan, or feedback.
export function useResumePipeline(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reply: PipelineResume) => api.post(`forge/${issueId}/resume`, { json: reply }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: forgeKey(issueId) }),
  })
}

export function usePipelineControl(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: 'pause' | 'continue') => api.post(`forge/${issueId}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: forgeKey(issueId) }),
  })
}

export function useRedirectPipeline(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: PipelineRedirect) => api.post(`forge/${issueId}/redirect`, { json: request, timeout: false }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: forgeKey(issueId) }),
  })
}
