import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatGptStatus } from 'shared'
import { api } from './client.ts'

export const chatGptKey = ['chatgpt']

// Whether zini is signed in to a ChatGPT plan; kept current by chatgpt.updated events.
export function useChatGpt() {
  return useQuery({
    queryKey: chatGptKey,
    queryFn: () => api.get('chatgpt').json<ChatGptStatus>(),
  })
}

// The models the plan offers, while signed in.
export function useChatGptModels(enabled: boolean) {
  return useQuery({
    queryKey: [...chatGptKey, 'models'],
    queryFn: () => api.get('chatgpt/models').json<{ slug: string; name: string }[]>(),
    enabled,
  })
}

// Starts a sign-in and opens it in a new tab; it finishes in that tab, and an event
// updates the status.
export function useChatGptSignIn() {
  return useMutation({
    mutationFn: () => api.post('chatgpt/sign-in').json<{ url: string }>(),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener'),
  })
}

export function useChatGptSignOut() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete('chatgpt').json<ChatGptStatus>(),
    onSuccess: (data) => queryClient.setQueryData(chatGptKey, data),
  })
}
