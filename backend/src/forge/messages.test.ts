import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint";
import { forgeMessages } from "./messages.js";
import { stampMessages } from "../agents/messageTimestamps.js";

function saved(thread: string, n: number, values: Record<string, unknown>, writes: CheckpointTuple["pendingWrites"] = []): CheckpointTuple {
  stampMessages(values, new Date(n * 1000).toISOString());
  return { config: { configurable: { thread_id: thread, checkpoint_ns: "" } },
    checkpoint: { v: 4, id: String(n).padStart(8, "0"), ts: new Date(n * 1000).toISOString(),
      channel_values: values, channel_versions: {}, versions_seen: {} }, pendingWrites: writes };
}

test("merges the Lead's and workers' conversations in time order, without system prompts", () => {
  const start = new HumanMessage({ id: "start", content: "Start work on this issue.", additional_kwargs: { username: "luca" } });
  const delegate = new AIMessage({ id: "delegate", content: "", tool_calls: [{ id: "d", name: "delegate_coder", args: { brief: "Do S1" } }] });
  const brief = new HumanMessage({ id: "brief", content: "Do S1", additional_kwargs: { username: "Lead" } });
  const reading = new AIMessage({ id: "reading", content: "Reading", tool_calls: [
    { id: "a", name: "read_file", args: { path: "/a" } }, { id: "b", name: "read_file", args: { path: "/b" } }] });
  const items = forgeMessages([
    { agent: "lead", checkpoint: saved("forge:x", 1, { messages: [new SystemMessage("PRIVATE SYSTEM PROMPT"), start, delegate,
      new ToolMessage({ tool_call_id: "d", content: "{\"report\":\"Done\"}" })] }) },
    { agent: "coder", checkpoint: saved("forge:x:coder", 2, { messages: [brief, reading,
      new ToolMessage({ tool_call_id: "b", content: "B" }), new ToolMessage({ tool_call_id: "a", content: "A" })] }) },
  ], null);
  assert.ok(!JSON.stringify(items).includes("PRIVATE SYSTEM PROMPT"));
  assert.deepEqual(items.filter((item) => item.kind === "message" && item.message.role === "user")
    .map((item) => item.kind === "message" && item.message.role === "user" && [item.agent, item.message.username]), [["lead", "luca"], ["coder", "Lead"]]);
  assert.deepEqual(items.filter((item) => item.kind === "tool").map((item) => item.kind === "tool" && [item.call.name, item.result]),
    [["delegate_coder", "{\"report\":\"Done\"}"], ["read_file", "A"], ["read_file", "B"]]);
  assert.deepEqual(items.map((item) => item.t), [...items.map((item) => item.t)].sort());
});

test("calls without results are pending only for the agent working now; the Lead's delegation too", () => {
  const delegate = new AIMessage({ id: "delegate", content: "", tool_calls: [{ id: "d", name: "delegate_coder", args: { brief: "Do S1" } }] });
  const reading = new AIMessage({ id: "reading", content: "", tool_calls: [{ id: "r", name: "read_file", args: { path: "/a" } }] });
  const threads = [
    { agent: "lead" as const, checkpoint: saved("forge:x", 1, { messages: [delegate] }) },
    { agent: "coder" as const, checkpoint: saved("forge:x:coder", 2, { messages: [reading] }) },
  ];
  const statuses = (running: "coder" | null) => forgeMessages(threads, running)
    .flatMap((item) => item.kind === "tool" ? [item.call.status] : []);
  assert.deepEqual(statuses("coder"), ["pending", "pending"]);
  assert.deepEqual(statuses(null), ["never_ran", "never_ran"]);
});

test("compaction and reports show as markers, and results saved as pending writes count", () => {
  const original = new AIMessage({ id: "original", content: "Original answer" });
  const summary = new HumanMessage({ id: "original", content: "Summary", additional_kwargs: { lc_source: "summarization" } });
  const submit = new AIMessage({ id: "submit", content: "", tool_calls: [{ id: "s", name: "submit_work", args: {} }] });
  const submission = new ToolMessage({ name: "submit_work", tool_call_id: "s", content: "{}" });
  const receipt = new AIMessage({ id: "receipt", content: "Returning structured response: {}" });
  const live = new AIMessage({ id: "live", content: "", tool_calls: [{ id: "l", name: "read_file", args: { path: "/a" } }] });
  const items = forgeMessages([{ agent: "coder", checkpoint: saved("forge:x:coder", 1,
    { compacted: [original], messages: [summary, submit, submission, receipt, live] },
    [["task", "messages", [new ToolMessage({ tool_call_id: "l", content: "Live result" })]]]) }], "coder");
  const messages = items.flatMap((item) => item.kind === "message" ? [item.message] : []);
  assert.ok(messages.some((message) => message.role === "compaction"));
  assert.ok(!messages.some((message) => message.role === "user"));
  assert.ok(messages.some((message) => message.role === "assistant" && message.content === "Report submitted."));
  assert.deepEqual(items.flatMap((item) => item.kind === "tool" ? [[item.call.name, item.call.status, item.result]] : []),
    [["read_file", "done", "Live result"]]);
});

test("the user's messages keep their images, image-only ones too", () => {
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const items = forgeMessages([{ agent: "lead", checkpoint: saved("forge:x", 1, { messages: [
    new HumanMessage({ id: "with-text", content: [{ type: "text", text: "Like this" }, { type: "image_url", image_url: { url: image } }] }),
    new HumanMessage({ id: "image-only", content: [{ type: "text", text: "" }, { type: "image_url", image_url: { url: image } }] }),
  ] }) }], null);
  assert.deepEqual(items.map((item) => item.kind === "message" && item.message.role === "user" && [item.message.content, item.message.images]),
    [["Like this", [image]], ["", [image]]]);
});
