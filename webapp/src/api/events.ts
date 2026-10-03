import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ServerEvent } from 'shared'
import { approvalsKey, coordinatorKey, runLogsKey } from './coordinator.ts'
import { evalsKey } from './evals.ts'
import { threadKey, threadsKey } from './productManager.ts'
import { workspaceKey, workspacesKey } from './workspaces.ts'

// Keeps the app up to date, from one connection to the server's events (mounted once,
// in App). Each event says what changed, and that's refetched: a chat (and the chat
// list) when a product manager run starts, finishes a step, ends or fails; a
// workspace when its setup starts or ends. On (re)connect everything is refetched, in
// case events were missed while disconnected.
export function useServerEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const events = new EventSource('/api/events')
    events.onopen = () => {
      queryClient.invalidateQueries({ queryKey: threadsKey })
      queryClient.invalidateQueries({ queryKey: workspacesKey })
      queryClient.invalidateQueries({ queryKey: ['coordinator'] })
    }
    events.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as ServerEvent
      if (event.type === 'thread.updated') {
        queryClient.invalidateQueries({ queryKey: threadKey(event.threadId) })
        queryClient.invalidateQueries({ queryKey: threadsKey, exact: true })
      } else if (event.type === 'workspace.updated') {
        queryClient.invalidateQueries({ queryKey: workspaceKey(event.issueId) })
      } else if (event.type === 'eval.updated') {
        // The status and its output, and the results, which change as runs end.
        queryClient.invalidateQueries({ queryKey: evalsKey })
      } else if (event.type === 'coordinator.updated') {
        queryClient.invalidateQueries({ queryKey: coordinatorKey(event.issueId) })
        // Whether it's waiting for an approval, for the issue lists.
        queryClient.invalidateQueries({ queryKey: approvalsKey })
        // The workspace says whether its coordinator is working (it can't be deleted then).
        queryClient.invalidateQueries({ queryKey: workspaceKey(event.issueId), exact: true })
      } else {
        // A line was added to a run's log: that run, and the list (a new run, or an
        // ended one's outcome). Only fetched if they're shown.
        queryClient.invalidateQueries({ queryKey: runLogsKey(event.issueId), exact: true })
        queryClient.invalidateQueries({ queryKey: [...runLogsKey(event.issueId), event.runId] })
      }
    }
    return () => events.close()
  }, [queryClient])
}
