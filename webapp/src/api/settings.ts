import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Settings } from 'shared'
import { api } from './client.ts'

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
    mutationFn: (changes: Partial<Record<keyof Settings, string>> & { confirmWorkspaceDeletion?: boolean }) =>
      api.put('settings', { json: changes, timeout: false }).json<Settings>(),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKey, data)
    },
    onSettled: (_data, _error, changes) => {
      if (changes.githubRepo) {
        void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
        void queryClient.invalidateQueries({ queryKey: ['forge'] })
      }
    },
  })
}
