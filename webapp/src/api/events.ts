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
    // An event while a refetch it calls for is still loading waits for it, rather than
    // starting the request over: a busy Forge sends them faster than some requests load.
    const refetch = (queryKey: readonly unknown[], exact = false) =>
      queryClient.invalidateQueries({ queryKey, exact }, { cancelRefetch: false });
    const events = new EventSource("/api/events");
    events.onopen = () => {
      refetch(threadsKey);
      refetch(subscriptionsKey);
      refetch(workspacesKey);
      refetch(["forge"]);
    };
    events.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as ServerEvent;
      if (event.type === "thread.updated") {
        refetch(threadKey(event.threadId));
        refetch(threadsKey, true);
        refetch(subscriptionsKey);
      } else if (event.type === "workspace.updated") {
        refetch(workspaceKey(event.issueId));
      } else if (event.type === "chatgpt.updated") {
        // Signed in or out: its status, and the plan's models.
        refetch(chatGptKey);
      } else if (event.type === "eval.updated") {
        // The status and its output, and the results, which change as runs end.
        refetch(evalsKey);
      } else if (event.type === "openwiki.updated") {
        // The docs scan started, finished or failed: its status, and the wiki
        // pages once they exist.
        refetch(openwikiKey);
      } else if (event.type === "forge.updated") {
        // The Forge and its conversations both come from saved checkpoints.
        refetch(forgeKey(event.issueId), true);
        refetch(forgeMessagesKey(event.issueId));
      } else if (event.type === "forge.status") {
        // Whether it's waiting for an approval, for the issue lists, and whether its
        // workspace can be deleted, which change only as it starts or stops running.
        refetch(approvalsKey);
        refetch(workspaceKey(event.issueId), true);
      }
    };
    return () => events.close();
  }, [queryClient]);
}
