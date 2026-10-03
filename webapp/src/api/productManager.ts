import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ChatMessage, Decision, Thread, ThreadSummary } from 'shared'
import { api } from './client.ts'
import { profileKey, type Profile } from './profile.ts'

export const threadsKey = ['product-manager', 'threads']
export const threadKey = (id: string) => [...threadsKey, id]

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

// Sending answers once the message is saved, so any fetch of the chat after that has it;
// the agent's reply comes through useServerEvents.
const post = (path: string, json: object) => api.post(`product-manager/${path}`, { json })

// Shows a change to a conversation straight away, before the server has it: cancels
// fetches that could overwrite it, applies it to the cached data, and returns a way to
// undo it if the request fails.
async function updateNow<T>(queryClient: QueryClient, key: unknown[], change: (data: T) => T) {
  await queryClient.cancelQueries({ queryKey: key })
  const previous = queryClient.getQueryData<T>(key)
  if (previous) queryClient.setQueryData(key, change(previous))
  return () => queryClient.setQueryData(key, previous)
}

// The user's message as the server will save it: with their username, if they've set
// one, so it doesn't change when the chat is fetched.
function userMessage(queryClient: QueryClient, content: string): ChatMessage {
  const username = queryClient.getQueryData<Profile>(profileKey)?.username
  return { role: 'user', content, ...(username && { username }) }
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
        messages: [userMessage(queryClient, message)],
        pending: [],
        notes: '',
        todos: [],
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
      updateNow<Thread>(queryClient, threadKey(threadId), (thread) => ({
        ...thread,
        messages: [...thread.messages, userMessage(queryClient, message)],
        running: true,
        error: null,
      })),
    onError: (_err, _message, undo) => undo?.(),
  })
}

// Stops the run going on the chat: it stops showing as running straight away, before
// the server has stopped it, and the messages and last step it reached stay where they
// are.
export function useStopThread(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => post(`threads/${id}/stop`, {}),
    onMutate: () =>
      updateNow<Thread>(queryClient, threadKey(id), (thread) => ({
        ...thread,
        running: false,
      })),
    onError: (_err, _variables, undo) => undo?.(),
  })
}

// Sends a message that redirects the agent while it works: the server stops the run and
// starts a new one from the message. The message shows right away, with the run going
// on again, the way a sent one does.
export function useSteerThread(threadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (message: string) => post(`threads/${threadId}/steer`, { message }),
    onMutate: (message) =>
      updateNow<Thread>(queryClient, threadKey(threadId), (thread) => ({
        ...thread,
        messages: [...thread.messages, userMessage(queryClient, message)],
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
      updateNow<Thread>(queryClient, threadKey(threadId), (thread) => ({
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
