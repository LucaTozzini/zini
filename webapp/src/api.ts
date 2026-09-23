import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ky, { HTTPError } from 'ky'
import type { LinearIssue, StatusType } from 'shared'

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

type LinearStatus = { connected: boolean; valid?: boolean; keyHint?: string }

const linearKey = ['integrations', 'linear']

export function useLinearStatus() {
  return useQuery({
    queryKey: linearKey,
    queryFn: () => api.get('integrations/linear').json<LinearStatus>(),
  })
}

export function useConnectLinear() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (apiKey: string) =>
      api.put('integrations/linear', { json: { apiKey } }).json<LinearStatus>(),
    onSuccess: (data) => {
      queryClient.setQueryData(linearKey, data)
      // A new key can see different issues.
      queryClient.invalidateQueries({ queryKey: [...linearKey, 'issues'] })
    },
  })
}

export function useDisconnectLinear() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete('integrations/linear').json<LinearStatus>(),
    onSuccess: (data) => queryClient.setQueryData(linearKey, data),
  })
}

// Only fetches once a working key is saved; otherwise the request would just fail.
export function useLinearIssues(statuses: StatusType[]) {
  const { data: status } = useLinearStatus()
  return useQuery({
    queryKey: [...linearKey, 'issues', statuses],
    queryFn: () =>
      api
        .get('integrations/linear/issues', { searchParams: { status: statuses.join(',') } })
        .json<{ issues: LinearIssue[] }>()
        .then((res) => res.issues),
    enabled: Boolean(status?.connected && status.valid),
  })
}
