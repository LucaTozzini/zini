import assert from "node:assert/strict";
import test from "node:test";
import { HumanMessage } from "@langchain/core/messages";
import { freshQueuedMessages } from "./queuedMessages.js";

test("recovery after conversation save doesn't redeliver acknowledged input", () => {
  const event = { eventId: "stable-event", source: "forge", sourceId: "issue", eventType: "completed", content: "Done" };
  const first = freshQueuedMessages([], [event]);
  assert.equal(first[0]!.id, "stable-event");
  assert.equal(first[0]!.additional_kwargs.issueId, "issue");
  assert.deepEqual(freshQueuedMessages(first, [event]), []);
  // Existing IDs include compacted history as well as the current conversation.
  assert.deepEqual(freshQueuedMessages([new HumanMessage({ id: event.eventId, content: "Saved before crash" })], [event]), []);
});

test("other queue sources are preserved without Forge metadata", () => {
  const [message] = freshQueuedMessages(
    [],
    [{ eventId: "reminder", source: "scheduler", sourceId: "job", eventType: "reminder", content: "Check progress" }],
  );
  assert.equal(message!.additional_kwargs.source, "scheduler");
  assert.equal(message!.additional_kwargs.issueId, undefined);
});
