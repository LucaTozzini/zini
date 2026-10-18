import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "shared";
import { approvalsKey, forgeKey, forgeMessagesKey } from "./forge.ts";
import { chatGptKey } from "./chatgpt.ts";
import { evalsKey } from "./evals.ts";
import { openwikiKey } from "./openwiki.ts";
import { subscriptionsKey, threadKey, threadsKey } from "./projectLead.ts";
import { workspaceKey, workspacesKey } from "./workspaces.ts";

// Keeps the app up to date, from one connection to the server's events (mounted once,
// in App). Each event says what changed, and that's refetched: a chat (and the chat
// list) when a project lead run starts, finishes a step, ends or fails; a
// workspace when its setup starts or ends. On (re)connect everything is refetched, in
// case events were missed while disconnected.
export function useServerEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onopen = () => {
      queryClient.invalidateQueries({ queryKey: threadsKey });
      queryClient.invalidateQueries({ queryKey: subscriptionsKey });
      queryClient.invalidateQueries({ queryKey: workspacesKey });
      queryClient.invalidateQueries({ queryKey: ["forge"] });
    };
    events.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as ServerEvent;
      if (event.type === "thread.updated") {
        queryClient.invalidateQueries({ queryKey: threadKey(event.threadId) });
        queryClient.invalidateQueries({ queryKey: threadsKey, exact: true });
        queryClient.invalidateQueries({ queryKey: subscriptionsKey });
      } else if (event.type === "workspace.updated") {
        queryClient.invalidateQueries({ queryKey: workspaceKey(event.issueId) });
      } else if (event.type === "chatgpt.updated") {
        // Signed in or out: its status, and the plan's models.
        queryClient.invalidateQueries({ queryKey: chatGptKey });
      } else if (event.type === "eval.updated") {
        // The status and its output, and the results, which change as runs end.
        queryClient.invalidateQueries({ queryKey: evalsKey });
      } else if (event.type === "openwiki.updated") {
        // The docs scan started, finished or failed: its status, and the wiki
        // pages once they exist.
        queryClient.invalidateQueries({ queryKey: openwikiKey });
      } else if (event.type === "forge.updated") {
        // The Forge and chat both come from saved checkpoints.
        queryClient.invalidateQueries({ queryKey: forgeKey(event.issueId), exact: true });
        queryClient.invalidateQueries({ queryKey: forgeMessagesKey(event.issueId) });
        // Whether it's waiting for an approval, for the issue lists.
        queryClient.invalidateQueries({ queryKey: approvalsKey });
        // The workspace says whether its forge is working (it can't be deleted then).
        queryClient.invalidateQueries({ queryKey: workspaceKey(event.issueId), exact: true });
      }
    };
    return () => events.close();
  }, [queryClient]);
}
