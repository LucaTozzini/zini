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
  PipelineResume,
  PipelineState,
  PullRequest,
  PullRequestStatus,
  RunLogEvent,
  RunLogSummary,
  WorkspaceDiff,
  ServerEvent,
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

const workspacesKey = ['workspaces']
const workspaceKey = (issueId: string) => [...workspacesKey, issueId]

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

// Runs the setup command again; its outcome comes through useServerEvents.
export function useRerunSetup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) => api.post(`workspaces/${issueId}/setup`).json<Workspace>(),
    onSuccess: (workspace) => queryClient.setQueryData(workspaceKey(workspace.issueId), workspace),
  })
}

// The end of the workspace's last setup output, fetched while enabled (e.g. the log is
// open). Under the workspace's key, so it's refetched with it; every 2s while running.
export function useSetupLog(issueId: string, enabled: boolean, running: boolean) {
  return useQuery({
    queryKey: [...workspaceKey(issueId), 'setup-log'],
    queryFn: () => api.get(`workspaces/${issueId}/setup-log`).text(),
    enabled,
    refetchInterval: running ? 2000 : false,
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
      } else if (event.type === 'coordinator.updated') {
        queryClient.invalidateQueries({ queryKey: coordinatorKey(event.issueId) })
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
        facts: [],
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
        messages: [...thread.messages, { role: 'user', content: message }],
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
      updateNow<Thread>(queryClient, threadKey(threadId), (thread) => ({
        ...thread,
        pending: [],
        running: true,
        error: null,
      })),
    onError: (_err, _decisions, undo) => undo?.(),
  })
}

const coordinatorKey = (issueId: string) => ['coordinator', issueId]

// The issue's coordinator pipeline (one per issue). Its progress comes through
// useServerEvents, which refetches it (and the diff below) on coordinator.updated.
export function useCoordinator(issueId: string) {
  return useQuery({
    queryKey: coordinatorKey(issueId),
    queryFn: () => api.get(`coordinator/${issueId}`).json<PipelineState>(),
  })
}

// The workspace's changes so far. Under the coordinator's key, so it's refetched with
// it, e.g. after every file the coder writes.
export function useWorkspaceDiff(issueId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...coordinatorKey(issueId), 'diff'],
    queryFn: () => api.get(`workspaces/${issueId}/diff`).json<WorkspaceDiff>(),
    enabled,
  })
}

const runLogsKey = (issueId: string) => [...coordinatorKey(issueId), 'logs']

// The issue's subagent runs, oldest first, kept up to date by useServerEvents.
export function useRunLogs(issueId: string) {
  return useQuery({
    queryKey: runLogsKey(issueId),
    queryFn: () => api.get(`coordinator/${issueId}/logs`).json<RunLogSummary[]>(),
  })
}

// One run's log, fetched while enabled (e.g. its section is open); refetched on each
// line added.
export function useRunLog(issueId: string, runId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...runLogsKey(issueId), runId],
    queryFn: () => api.get(`coordinator/${issueId}/logs/${runId}`).json<RunLogEvent[]>(),
    enabled,
  })
}

// Starting and replying answer once the run has started; refetching then shows it.
export function useStartPipeline(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (note: string) => api.post(`coordinator/${issueId}/start`, { json: { note } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: coordinatorKey(issueId) }),
  })
}

// Replies to what the pipeline is waiting on: answers, approving the plan, or feedback.
export function useResumePipeline(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reply: PipelineResume) => api.post(`coordinator/${issueId}/resume`, { json: reply }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: coordinatorKey(issueId) }),
  })
}

// Writes a commit message for the workspace's uncommitted changes; a model call, so no
// timeout.
export function useWriteCommitMessage(issueId: string) {
  return useMutation({
    mutationFn: () =>
      api
        .post(`coordinator/${issueId}/commit-message`, { timeout: false })
        .json<{ commitMessage: string }>(),
  })
}

// Commits the uncommitted changes with message (if any), then pushes the branch.
export function useCommitAndPush(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (message: string) =>
      api.post(`workspaces/${issueId}/commit`, { json: { message }, timeout: false }).json<Workspace>(),
    onSuccess: (workspace) => queryClient.setQueryData(workspaceKey(issueId), workspace),
  })
}

const pullRequestKey = (issueId: string) => [...workspaceKey(issueId), 'pull-request']

// Whether the branch is on GitHub, and its pull request, fetched while enabled (e.g.
// everything is pushed). Under the workspace's key, so a push refetches it.
export function usePullRequest(issueId: string, enabled: boolean) {
  return useQuery({
    queryKey: pullRequestKey(issueId),
    queryFn: () => api.get(`workspaces/${issueId}/pull-request`).json<PullRequestStatus>(),
    enabled,
  })
}

// Writes a pull request's title and body for the branch; a model call, so no timeout.
export function useWritePullRequest(issueId: string) {
  return useMutation({
    mutationFn: () =>
      api
        .post(`coordinator/${issueId}/pull-request-text`, { timeout: false })
        .json<{ title: string; body: string }>(),
  })
}

// Opens the pull request, which then shows in place of the form.
export function useOpenPullRequest(issueId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pull: { title: string; body: string }) =>
      api.post(`workspaces/${issueId}/pull-request`, { json: pull, timeout: false }).json<PullRequest>(),
    onSuccess: (pullRequest) =>
      queryClient.setQueryData<PullRequestStatus>(pullRequestKey(issueId), { pushed: true, pullRequest }),
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
