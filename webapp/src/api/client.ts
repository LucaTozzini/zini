import ky, { HTTPError } from 'ky'

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
