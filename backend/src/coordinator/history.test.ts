import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { loadCoordinatorHistory } from "./history.js";
import { checkpointMessages } from "./messages.js";
import { timestampedSerializer } from "../agents/messageTimestamps.js";

test("latest namespace histories preserve earlier turns, compaction, live results and document timing", async () => {
  const saver = SqliteSaver.fromConnString(":memory:");
  saver.serde = timestampedSerializer(saver.serde);
  const thread = "coordinator:test";
  const put = async (ns: string, n: number, values: Record<string, unknown>, versions: Record<string, string> = {}) =>
    saver.put({ configurable: { thread_id: thread, checkpoint_ns: ns } }, {
      v: 4, id: String(n).padStart(8, "0"), ts: new Date(n * 1000).toISOString(),
      channel_values: values, channel_versions: versions, versions_seen: {},
    }, { source: "loop", step: n, parents: {} });
  const original = new AIMessage({ id: "original", content: "Implemented." });
  const summary = new HumanMessage({ id: "original", content: "Summary", additional_kwargs: { lc_source: "summarization" } });
  const submission = new ToolMessage({ name: "submit_implementation", tool_call_id: "submit", content: "{}" });
  const rawReceipt = 'Returning structured response: {"blockingQuestions":[]}';
  try {
    await put("", 1, { plan: { summary: "Plan" } }, { plan: "1" });
    const old = await put("coder", 2, { messages: [original] });
    const receipt = new AIMessage({ content: rawReceipt });
    await saver.putWrites(old, [["messages", [submission, receipt]]], "old-task");
    const receiptTime = receipt.additional_kwargs.createdAt;
    assert.equal(typeof receiptTime, "string");
    receipt.id = "receipt";
    await put("coder", 3, { compacted: [original], messages: [summary, submission,
      receipt] });
    await put("reviewer:first", 4, { messages: [new AIMessage({ id: "review-one", content: "First review." })] });
    const live = await put("reviewer:second", 5, { messages: [new AIMessage({ id: "review-two", content: "Inspecting.",
      tool_calls: [{ id: "read", name: "read_file", args: { path: "/a" } }] })] });
    await saver.putWrites(live, [["messages", [new ToolMessage({ tool_call_id: "read", content: "Live result" })]]], "live-task");
    await put("", 6, { plan: { summary: "Plan" }, implementation: {} }, { plan: "1", implementation: "2" });
    const { checkpoints } = await loadCoordinatorHistory(saver, thread);
    assert.equal(checkpoints.length, 5); // Two root versions and three agent namespaces.
    assert.equal(checkpoints.filter((c) => c.config.configurable?.checkpoint_ns === "coder").length, 1);
    const items = checkpointMessages(checkpoints, true);
    const messages = items.filter((item) => item.kind === "message");
    assert.equal(messages.filter((m) => m.message.role === "assistant" && m.message.content === "Document submitted.").length, 1);
    assert.equal(messages.find((m) => m.message.role === "assistant" && m.message.content === "Implemented.")?.t, original.additional_kwargs.createdAt);
    assert.ok(messages.some((m) => m.message.role === "compaction"));
    assert.ok(messages.some((m) => m.message.role === "assistant" && m.message.content === "First review."));
    assert.ok(items.some((m) => m.kind === "tool" && m.result === "Live result" && m.call.status === "done"));
    assert.equal(items.filter((m) => m.kind === "document").length, 2);
    const persisted = await saver.getTuple({ configurable: { thread_id: thread, checkpoint_ns: "coder" } });
    const savedMessages = persisted!.checkpoint.channel_values.messages as AIMessage[];
    assert.equal(savedMessages.at(-1)?.text, rawReceipt);
    assert.equal(savedMessages.at(-1)?.additional_kwargs.createdAt, receiptTime);
    assert.equal(typeof summary.additional_kwargs.createdAt, "string");
  } finally { saver.db.close(); }
});
