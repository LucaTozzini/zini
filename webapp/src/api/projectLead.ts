import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  fileInfo,
  type ChatEntry,
  type ProjectLeadMessage,
  type Decision,
  type Thread,
  type ThreadSummary,
  type User,
} from "shared";
import { api } from "./client.ts";
import { userKey } from "./users.ts";
import { projectApiPath, useProjectId } from "../hooks/useProject.ts";

export const threadsKey = ["project-lead", "threads"];
export const threadKey = (id: string) => [...threadsKey, id];
// Each project's chat list.
export const threadListsKey = [...threadsKey, "list"];
const threadListKey = (projectId: number) => [...threadListsKey, projectId];

// The project's Project Lead API path.
const leadPath = (projectId: number, path: string) => projectApiPath(projectId, `project-lead/${path}`);

export function useThreads() {
  const projectId = useProjectId();
  return useQuery({
    queryKey: threadListKey(projectId),
    queryFn: () => api.get(leadPath(projectId, "threads")).json<ThreadSummary[]>(),
  });
}

export function useThread(id: string | undefined) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: threadKey(id ?? ""),
    queryFn: () => api.get(leadPath(projectId, `threads/${id}`)).json<Thread>(),
    enabled: Boolean(id),
  });
}

// Sending answers once the message is saved, so any fetch of the chat after that has it;
// the agent's reply comes through useServerEvents.
const post = (projectId: number, path: string, json: object) => api.post(leadPath(projectId, path), { json });

// Shows a change to a conversation straight away, before the server has it: cancels
// fetches that could overwrite it, applies it to the cached data, and returns a way to
// undo it if the request fails.
async function updateNow<T>(queryClient: QueryClient, key: unknown[], change: (data: T) => T) {
  await queryClient.cancelQueries({ queryKey: key });
  const previous = queryClient.getQueryData<T>(key);
  if (previous) queryClient.setQueryData(key, change(previous));
  return () => queryClient.setQueryData(key, previous);
}

// Match the signed-in author the server saves with the message.
function userMessage(queryClient: QueryClient, payload: ProjectLeadMessage): ChatEntry {
  const username = queryClient.getQueryData<User>(userKey)?.username;
  return {
    id: "sending",
    role: "user",
    content: payload.message,
    images: payload.images,
    files: fileInfo(payload.files),
    ...(username && { username }),
  };
}

// Starts a chat with its first message; resolves to the new chat, cached with that
// message and running, so opening it shows both at once.
export function useCreateThread() {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  return useMutation({
    mutationFn: (message: ProjectLeadMessage) => post(projectId, "threads", message).json<ThreadSummary>(),
    onSuccess: ({ id, title }, message) => {
      queryClient.setQueryData<Thread>(threadKey(id), {
        id,
        title,
        messages: [userMessage(queryClient, message)],
        pending: [],
        notes: "",
        todos: [],
        subscriptions: [],
        running: true,
        error: null,
      });
      void queryClient.invalidateQueries({ queryKey: threadListKey(projectId) });
    },
  });
}

// The message shows in the chat, with "thinking", as soon as it's sent.
export function useSendMessage(threadId: string) {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  return useMutation({
    mutationFn: (message: ProjectLeadMessage) => post(projectId, `threads/${threadId}/messages`, message),
    onMutate: (message) =>
      updateNow<Thread>(queryClient, threadKey(threadId), (thread) => ({
        ...thread,
        messages: [...thread.messages, userMessage(queryClient, message)],
        running: true,
        error: null,
      })),
    onError: (_err, _message, undo) => undo?.(),
  });
}

// Stops the run going on the chat: it stops showing as running straight away, before
// the server has stopped it, and the messages and last step it reached stay where they
// are.
export function useStopThread(id: string) {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  return useMutation({
    mutationFn: () => post(projectId, `threads/${id}/stop`, {}),
    onMutate: () =>
      updateNow<Thread>(queryClient, threadKey(id), (thread) => ({
        ...thread,
        running: false,
      })),
    onError: (_err, _variables, undo) => undo?.(),
  });
}

// Sends a message that redirects the agent while it works: the server stops the run and
// starts a new one from the message. The message shows right away, with the run going
// on again, the way a sent one does.
export function useSteerThread(threadId: string) {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  return useMutation({
    mutationFn: (message: ProjectLeadMessage) => post(projectId, `threads/${threadId}/steer`, message),
    onMutate: (message) =>
      updateNow<Thread>(queryClient, threadKey(threadId), (thread) => ({
        ...thread,
        messages: [...thread.messages, userMessage(queryClient, message)],
        running: true,
        error: null,
      })),
    onError: (_err, _message, undo) => undo?.(),
  });
}

// Approves or rejects the actions the agent paused on, one decision per action. The
// approval card goes, and "thinking" shows, as soon as it's sent.
export function useResumeThread(threadId: string) {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  return useMutation({
    mutationFn: (decisions: Decision[]) => post(projectId, `threads/${threadId}/resume`, { decisions }),
    onMutate: () =>
      updateNow<Thread>(queryClient, threadKey(threadId), (thread) => ({
        ...thread,
        pending: [],
        running: true,
        error: null,
      })),
    onError: (_err, _decisions, undo) => undo?.(),
  });
}

// Deletes a chat and its saved conversation.
export function useDeleteThread() {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  return useMutation({
    mutationFn: (id: string) => api.delete(leadPath(projectId, `threads/${id}`)),
    onSuccess: (_res, id) => {
      queryClient.removeQueries({ queryKey: threadKey(id) });
      queryClient.invalidateQueries({ queryKey: threadListKey(projectId) });
    },
  });
}
