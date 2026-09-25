import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import ky, { HTTPError } from 'ky'
import type {
  Decision,
  Integrations,
  LinearIssue,
  LinearIssueDetails,
  Provider,
  Settings,
  StatusType,
  Thread,
  ThreadEvent,
  ThreadSummary,
  Workspace,
} from 'shared'

// Retries are left to TanStack Query.
export const api = ky.create({ prefix: '/api', retry: 0 })

// Pull the backend's `{ error }` message out of a failed request.
export function errorMessage(err: unknown) {
  if (err instanceof HTTPError) {
    const data = err.data as { error?: string } | undefined
    if (data?.error) return data.error
  }
  return err instanceof Error ? err.message : 'Something went wrong'
}

const integrationsKey = ['integrations']
const linearIssuesKey = ['linear', 'issues']

// Which services are connected. Keys are tested when saved, not here.
export function useIntegrations() {
  return useQuery({
    queryKey: integrationsKey,
    queryFn: () => api.get('integrations').json<Integrations>(),
  })
}

export function useConnectIntegration(provider: Provider) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (apiKey: string) =>
      api.put('integrations', { json: { [provider]: apiKey } }).json<Integrations>(),
    onSuccess: (data) => {
      queryClient.setQueryData(integrationsKey, data)
      // A new Linear key can see different issues.
      if (provider === 'linear') queryClient.invalidateQueries({ queryKey: linearIssuesKey })
    },
  })
}

export function useDisconnectIntegration(provider: Provider) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(`integrations/${provider}`).json<Integrations>(),
    onSuccess: (data) => queryClient.setQueryData(integrationsKey, data),
  })
}

export function useLinearIssues(statuses: StatusType[]) {
  return useQuery({
    queryKey: [...linearIssuesKey, statuses],
    queryFn: () =>
      api
        .get('integrations/linear/issues', { searchParams: { status: statuses.join(',') } })
        .json<{ issues: LinearIssue[] }>()
        .then((res) => res.issues),
  })
}

// One issue with its details, by identifier (e.g. ZIN-4) or id.
export function useLinearIssue(id: string) {
  return useQuery({
    queryKey: ['linear', 'issue', id],
    queryFn: () => api.get(`integrations/linear/issues/${id}`).json<LinearIssueDetails>(),
  })
}

const workspaceKey = (issueId: string) => ['workspaces', issueId]

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

const settingsKey = ['settings']

export function useSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => api.get('settings').json<Settings>(),
  })
}

// Saves only the settings passed; returns all of them. No timeout, since saving the
// repo waits for it to be cloned, which can take a while for a big repo.
export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: Partial<Record<keyof Settings, string>>) =>
      api.put('settings', { json: changes, timeout: false }).json<Settings>(),
    onSuccess: (data) => queryClient.setQueryData(settingsKey, data),
  })
}

const threadsKey = ['product-manager', 'threads']
const threadKey = (id: string) => [...threadsKey, id]

export function useThreads() {
  return useQuery({
    queryKey: threadsKey,
    queryFn: () => api.get('product-manager/threads').json<ThreadSummary[]>(),
  })
}

export function useThread(id: string | undefined) {
  return useQuery({
    queryKey: threadKey(id ?? ''),
    queryFn: () => api.get(`product-manager/threads/${id}`).json<Thread>(),
    enabled: Boolean(id),
  })
}

// Keeps the chats up to date while mounted. The server sends thread.updated whenever
// a chat changes (a run starts, finishes a step, ends or fails), and that chat and the
// list are refetched. On (re)connect everything is refetched, in case events were
// missed while disconnected.
export function useThreadEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const events = new EventSource('/api/product-manager/events')
    events.onopen = () => queryClient.invalidateQueries({ queryKey: threadsKey })
    events.onmessage = (e: MessageEvent<string>) => {
      const { threadId } = JSON.parse(e.data) as ThreadEvent
      queryClient.invalidateQueries({ queryKey: threadKey(threadId) })
      queryClient.invalidateQueries({ queryKey: threadsKey, exact: true })
    }
    return () => events.close()
  }, [queryClient])
}

// Sending answers once the message is saved, so any fetch of the chat after that has it;
// the agent's reply comes through useThreadEvents.
const post = (path: string, json: object) => api.post(`product-manager/${path}`, { json })

// Shows a change to a chat straight away, before the server has it: cancels fetches
// that could overwrite it, applies it to the cached chat, and returns a way to undo it
// if the request fails.
async function updateThreadNow(
  queryClient: QueryClient,
  threadId: string,
  change: (thread: Thread) => Thread,
) {
  const key = threadKey(threadId)
  await queryClient.cancelQueries({ queryKey: key })
  const previous = queryClient.getQueryData<Thread>(key)
  if (previous) queryClient.setQueryData(key, change(previous))
  return () => queryClient.setQueryData(key, previous)
}

// Starts a chat with its first message; resolves to the new chat, cached with that
// message and running, so opening it shows both at once.
export function useCreateThread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (message: string) => post('threads', { message }).json<ThreadSummary>(),
    onSuccess: ({ id, title }, message) => {
      queryClient.setQueryData<Thread>(threadKey(id), {
        id,
        title,
        messages: [{ role: 'user', content: message }],
        pending: [],
        running: true,
        error: null,
      })
      void queryClient.invalidateQueries({ queryKey: threadsKey, exact: true })
    },
  })
}

// The message shows in the chat, with "thinking", as soon as it's sent.
export function useSendMessage(threadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (message: string) => post(`threads/${threadId}/messages`, { message }),
    onMutate: (message) =>
      updateThreadNow(queryClient, threadId, (thread) => ({
        ...thread,
        messages: [...thread.messages, { role: 'user', content: message }],
        running: true,
        error: null,
      })),
    onError: (_err, _message, undo) => undo?.(),
  })
}

// Approves or rejects the actions the agent paused on, one decision per action. The
// approval card goes, and "thinking" shows, as soon as it's sent.
export function useResumeThread(threadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (decisions: Decision[]) => post(`threads/${threadId}/resume`, { decisions }),
    onMutate: () =>
      updateThreadNow(queryClient, threadId, (thread) => ({
        ...thread,
        pending: [],
        running: true,
        error: null,
      })),
    onError: (_err, _decisions, undo) => undo?.(),
  })
}

// Deletes a chat and its saved conversation.
export function useDeleteThread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`product-manager/threads/${id}`),
    onSuccess: (_res, id) => {
      queryClient.removeQueries({ queryKey: threadKey(id) })
      queryClient.invalidateQueries({ queryKey: threadsKey, exact: true })
    },
  })
}
