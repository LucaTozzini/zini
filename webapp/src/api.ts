import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ky, { HTTPError } from 'ky'
import type {
  ChatMessage,
  ChatResponse,
  Decision,
  Integrations,
  LinearIssue,
  Provider,
  Settings,
  StatusType,
  Thread,
  ThreadSummary,
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

const settingsKey = ['settings']

export function useSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => api.get('settings').json<Settings>(),
  })
}

// Saves only the settings passed; returns all of them.
export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: Partial<Record<keyof Settings, string>>) =>
      api.put('settings', { json: changes }).json<Settings>(),
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

// Agent turns can take a while when it calls several tools, so no timeout.
const post = <T>(path: string, json: object) =>
  api.post(`product-manager/${path}`, { json, timeout: false }).json<T>()

// Adds a finished turn to the cached thread instead of refetching it.
function appendTurn(thread: Thread, userMessage: string | null, { reply, pending }: ChatResponse): Thread {
  const messages: ChatMessage[] = [...thread.messages]
  if (userMessage) messages.push({ role: 'user', content: userMessage })
  if (reply) messages.push({ role: 'assistant', content: reply })
  return { ...thread, messages, pending }
}

// Starts a chat; resolves to the new thread's id.
export function useCreateThread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (message: string) =>
      post<ThreadSummary & ChatResponse>('threads', { message }),
    onSuccess: ({ id, title, ...response }, message) => {
      const empty: Thread = { id, title, messages: [], pending: [] }
      queryClient.setQueryData(threadKey(id), appendTurn(empty, message, response))
      queryClient.invalidateQueries({ queryKey: threadsKey, exact: true })
    },
  })
}

export function useSendMessage(threadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (message: string) => post<ChatResponse>(`threads/${threadId}/messages`, { message }),
    onSuccess: (response, message) =>
      queryClient.setQueryData<Thread>(threadKey(threadId), (thread) =>
        thread && appendTurn(thread, message, response),
      ),
  })
}

// Approves or rejects the actions the agent paused on, one decision per action.
export function useResumeThread(threadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (decisions: Decision[]) =>
      post<ChatResponse>(`threads/${threadId}/resume`, { decisions }),
    onSuccess: (response) =>
      queryClient.setQueryData<Thread>(threadKey(threadId), (thread) =>
        thread && appendTurn(thread, null, response),
      ),
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
