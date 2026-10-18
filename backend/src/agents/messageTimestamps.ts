import { BaseMessage } from "@langchain/core/messages";
import type { SerializerProtocol } from "@langchain/langgraph-checkpoint";

// Stamp on first persistence, including pending writes and framework-generated
// messages. Keep the timestamp when the message is saved again or compacted.
export function stampMessages(value: unknown, createdAt = new Date().toISOString(), seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (BaseMessage.isInstance(value)) {
    value.additional_kwargs.createdAt ??= createdAt;
    return;
  }
  for (const child of Object.values(value)) stampMessages(child, createdAt, seen);
}

export function timestampedSerializer(serializer: SerializerProtocol): SerializerProtocol {
  return {
    dumpsTyped(value) {
      stampMessages(value);
      return serializer.dumpsTyped(value);
    },
    loadsTyped(type, data) {
      return serializer.loadsTyped(type, data);
    },
  };
}
