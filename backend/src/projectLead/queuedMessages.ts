import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { QueuedMessage } from "../models/ProjectLeadQueueMessage.js";

export function freshQueuedMessages(existing: BaseMessage[], events: QueuedMessage[]) {
  const ids = new Set(existing.map((message) => message.id));
  return events.filter((event) => !ids.has(event.eventId)).map((event) => new HumanMessage({
    id: event.eventId,
    content: `[${event.source === "forge" ? "Forge" : event.source} update: ${event.sourceId}]\n${event.content}`,
    additional_kwargs: {
      source: event.source, sourceId: event.sourceId, eventId: event.eventId,
      eventType: event.eventType, content: event.content,
      ...(event.source === "forge" && { issueId: event.sourceId }),
    },
  }));
}
