import type { ReactNode, Ref } from "react";
import { Box } from "@mui/material";
import type { ChatEntry } from "shared";
import AiMessage from "./AiMessage.tsx";
import { HumanMessage } from "./HumanMessage.tsx";
import SystemMessage from "./SystemMessage.tsx";
import CompactionMarker from "../CompactionMarker.tsx";
import ToolCallLine from "../ToolCallLine.tsx";
import ToolCallGroup from "../ToolCallGroup.tsx";

type ToolEntry = Extract<ChatEntry, { role: "tool" }>;

// An agent's conversation: its messages, and its tool calls, consecutive ones (from the
// same agent, in a Forge's feed) as one group. renderCall can show a call on its own
// instead, e.g. the Forge Lead's delegations. lastMessageRef goes on the last message
// when it's the user's or the agent's.
export default function MessageList<T extends ChatEntry>({
  entries,
  busy,
  lastMessageRef,
  renderCall,
}: {
  entries: T[];
  busy: boolean;
  lastMessageRef?: Ref<HTMLDivElement>;
  renderCall?: (call: T & ToolEntry) => ReactNode;
}) {
  const agent = (entry: T) => ("agent" in entry ? entry.agent : undefined);
  const items: (
    { id: string; entry: T } | { id: string; node: ReactNode } | { id: string; calls: (T & ToolEntry)[]; agent: unknown }
  )[] = [];
  for (const entry of entries) {
    if (entry.role !== "tool") {
      items.push({ id: entry.id, entry });
      continue;
    }
    const call = entry as T & ToolEntry;
    const node = renderCall?.(call);
    const last = items.at(-1);
    if (node) items.push({ id: entry.id, node });
    else if (last && "calls" in last && last.agent === agent(entry)) last.calls.push(call);
    else items.push({ id: entry.id, calls: [call], agent: agent(entry) });
  }

  return items.map((item, i) => {
    const ref = i === items.length - 1 ? lastMessageRef : undefined;
    if ("node" in item)
      return (
        <Box key={item.id} data-chat-message="">
          {item.node}
        </Box>
      );
    if ("calls" in item)
      return (
        <Box key={item.id} data-chat-message="" sx={{ minWidth: 0 }}>
          {item.calls.length === 1 ? (
            <ToolCallLine call={item.calls[0]} busy={busy} />
          ) : (
            <ToolCallGroup calls={item.calls} busy={busy} />
          )}
        </Box>
      );
    const { entry } = item;
    switch (entry.role) {
      case "user":
        return <HumanMessage key={item.id} message={entry} ref={ref} />;
      case "assistant":
        return <AiMessage key={item.id} content={entry.content} ref={ref} />;
      case "compaction":
        return (
          <Box key={item.id} data-chat-message="">
            <CompactionMarker summary={entry.summary} />
          </Box>
        );
      case "activity":
        return (
          <Box key={item.id} data-chat-message="">
            <SystemMessage issueId={entry.issueId} content={entry.content} />
          </Box>
        );
      default:
        return null;
    }
  });
}
