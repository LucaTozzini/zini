import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Integrations, LinearIssue, LinearIssueDetails, Provider, StatusType } from 'shared'
import { api } from './client.ts'

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
