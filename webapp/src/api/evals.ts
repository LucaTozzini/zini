import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EvalBatch, EvalScenario, EvalStatus } from 'shared'
import { api } from './client.ts'

export const evalsKey = ['evals']
const statusKey = [...evalsKey, 'status']

export function useEvalScenarios() {
  return useQuery({
    queryKey: [...evalsKey, 'scenarios'],
    queryFn: () => api.get('evals/scenarios').json<EvalScenario[]>(),
  })
}

// The eval going on and its output, kept up to date by useServerEvents (eval.updated).
export function useEvalStatus() {
  return useQuery({
    queryKey: statusKey,
    queryFn: () => api.get('evals/status').json<EvalStatus>(),
  })
}

// Every batch of results, newest first; refetched with the status, so a finished run
// shows up.
export function useEvalBatches() {
  return useQuery({
    queryKey: [...evalsKey, 'batches'],
    queryFn: () => api.get('evals/batches').json<EvalBatch[]>(),
  })
}

// What one run changed, fetched while enabled (e.g. its diff is open).
export function useEvalRunDiff(scenario: string, batch: string, run: string, enabled: boolean) {
  return useQuery({
    queryKey: [...evalsKey, 'diff', scenario, batch, run],
    queryFn: () => api.get(`evals/batches/${scenario}/${batch}/${run}/diff`).text(),
    enabled,
  })
}

// Starting answers once the eval has started; its progress comes through events.
export function useStartEval() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (start: { scenario: string; repeat: number }) => api.post('evals/runs', { json: start }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKey }),
  })
}

export function useStopEval() {
  return useMutation({
    mutationFn: () => api.post('evals/stop'),
  })
}
