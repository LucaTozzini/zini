import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentRole, ForgeMessage, PendingApproval, ForgeResume, ForgeState } from "shared";
import { api } from "./client.ts";

export const forgeKey = (issueId: string) => ["forge", issueId];
export const forgeMessagesKey = (issueId: string) => [...forgeKey(issueId), "messages"];

// The Lead's conversation, or a worker's run for one of its delegate_coder or
// delegate_reviewer calls (delegation: that call's id).
export function useForgeMessages(issueId: string, agent: AgentRole = "lead", delegation?: string) {
  return useQuery({
    queryKey: [...forgeMessagesKey(issueId), agent, delegation ?? null],
    queryFn: () =>
      api
        .get(`forge/${issueId}/messages`, { searchParams: { agent, ...(delegation ? { delegation } : {}) } })
        .json<ForgeMessage[]>(),
  });
}

// The issue's Forge (one per issue). Its progress comes through
// useServerEvents, which refetches it (and the workspace diff) on forge.updated.
export function useForge(issueId: string) {
  return useQuery({
    queryKey: forgeKey(issueId),
    queryFn: () => api.get(`forge/${issueId}`).json<ForgeState>(),
  });
}

// Under ['forge'] like the Forges, so reconnecting refetches it with them.
export const approvalsKey = ["forge", "approvals"];

// The issues whose Forge is waiting for an approval; refetched by useServerEvents
// whenever a Forge changes.
export function usePendingApprovals() {
  return useQuery({
    queryKey: approvalsKey,
    queryFn: () => api.get("forge/approvals").json<PendingApproval[]>(),
  });
}

// Starting and replying answer once the run has started; refetching then shows it.
export function useStartForge(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => api.post(`forge/${issueId}/start`, { json: { note } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: forgeKey(issueId) }),
  });
}

// Replies to what the Forge is waiting on: answers, approving the plan, or feedback.
export function useResumeForge(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reply: ForgeResume) => api.post(`forge/${issueId}/resume`, { json: reply }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: forgeKey(issueId) }),
  });
}

export function useForgeControl(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: "pause" | "continue") => api.post(`forge/${issueId}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: forgeKey(issueId) }),
  });
}

// Sends the Lead a message, e.g. changes to make after it finished.
export function useMessageForge(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { message: string; images: string[] }) => api.post(`forge/${issueId}/message`, { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: forgeKey(issueId) }),
  });
}
