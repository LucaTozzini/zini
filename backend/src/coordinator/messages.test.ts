import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Annotation, Command, END, MemorySaver, START, StateGraph, interrupt } from "@langchain/langgraph";
import { createAgent, tool, toolStrategy } from "langchain";
import type { CheckpointTuple } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { checkpointMessages, humanMessage, replyMessage } from "./messages.js";

function saved(ns: string, n: number, values: Record<string, unknown>, versions: Record<string, string> = {}): CheckpointTuple {
  return { config: { configurable: { thread_id: "test", checkpoint_ns: ns } },
    checkpoint: { v: 4, id: String(n).padStart(8, "0"), ts: new Date(n * 1000).toISOString(),
      channel_values: values, channel_versions: versions, versions_seen: {} } };
}

test("aggregate namespaces, retain first-seen order, and show both sides without exposing system prompts", () => {
  const input = new HumanMessage({ id: "input", content: "Implement the plan." });
  const reply = new AIMessage({ id: "reply", content: "Reading files", tool_calls: [
    { id: "a", name: "read_file", args: { path: "/a" } }, { id: "b", name: "read_file", args: { path: "/b" } },
  ] });
  const calls = [new SystemMessage({ id: "system", content: "PRIVATE SYSTEM PROMPT" }), input, reply];
  const human = { id: "human", t: new Date(0).toISOString(), content: "My request", username: "luca" };
  const checkpoints = [saved("", 1, { humanMessages: [human] }), saved("coder", 2, { messages: [input] }),
    saved("coder", 3, { messages: calls }), saved("coder", 4, { messages: [...calls,
      new ToolMessage({ content: "B", tool_call_id: "b" }), new ToolMessage({ content: "A", tool_call_id: "a" })] }),
    saved("qa:attempt1", 5, { messages: [new HumanMessage({ id: "qa1", content: "Test" }), new AIMessage({ id: "answer", content: "Attempt one" })] }),
    saved("qa:attempt2", 6, { messages: [new HumanMessage({ id: "qa2", content: "Test again" }), new AIMessage({ id: "answer", content: "Attempt two" })] })];
  const items = checkpointMessages(checkpoints.reverse(), false);
  assert.equal(items.filter((item) => item.kind === "tool").length, 2);
  assert.deepEqual(items.filter((item) => item.kind === "tool").map((item) => item.kind === "tool" && item.result), ["A", "B"]);
  assert.equal(items.filter((item) => item.kind === "message" && item.message.role === "user").length, 4);
  assert.ok(items.some((item) => item.kind === "message" && item.message.role === "user" && item.message.username === "Coordinator" && item.message.content === "Implement the plan."));
  assert.ok(!JSON.stringify(items).includes("PRIVATE SYSTEM PROMPT"));
  assert.ok(JSON.stringify(items).includes("Attempt one"));
  assert.ok(JSON.stringify(items).includes("Attempt two"));
  assert.equal(items.find((item) => item.kind === "message" && item.message.role === "assistant")?.t, new Date(3000).toISOString());
});

test("compaction preserves original history without treating its summary as a human message", () => {
  const reply = new AIMessage({ id: "original", content: "Original answer" });
  const summary = new HumanMessage({ id: "original", content: "Summary", additional_kwargs: { lc_source: "summarization" } });
  const items = checkpointMessages([saved("planner", 1, { messages: [reply] }),
    saved("planner", 2, { compacted: [reply], messages: [summary] })], false);
  assert.equal(items.filter((item) => item.kind === "message").length, 2);
  assert.ok(!items.some((item) => item.kind === "message" && item.message.role === "user"));
});

test("document versions create one event each and deterministic checks have real results", () => {
  const report = { results: [{ command: "npm test", cwd: ".", output: "passed", status: "passed" }] };
  const items = checkpointMessages([saved("", 1, { plan: { summary: "Plan" } }, { plan: "1" }),
    saved("", 2, { plan: { summary: "Plan" } }, { plan: "1" }),
    saved("", 3, { checksReport: report }, { checksReport: "2" })], false);
  assert.equal(items.filter((item) => item.kind === "document").length, 2);
  assert.equal(items.find((item) => item.kind === "tool")?.kind, "tool");
});

test("approval requests remain pending while live and interrupted calls are not marked successful", () => {
  const message = new AIMessage({ id: "m", content: "", tool_calls: [{ id: "tool", name: "run_command", args: { command: "npm test" } }] });
  const checkpoints = [saved("qa:one", 1, { messages: [message] })];
  const live = checkpointMessages(checkpoints, true).find((item) => item.kind === "tool");
  const stopped = checkpointMessages(checkpoints, false).find((item) => item.kind === "tool");
  assert.equal(live?.kind === "tool" && live.call.status, "pending");
  assert.equal(stopped?.kind === "tool" && stopped.call.status, "error");
});

test("selected deterministic checks show live proposals and results replace them without duplication", () => {
  const selection = saved("", 1, { checksPlan: { commands: [{ command: "npm test", cwd: "." }] } }, { checksPlan: "1" });
  const pending = checkpointMessages([selection], true).find((item) => item.kind === "tool");
  assert.equal(pending?.kind === "tool" && pending.call.status, "pending");
  const report = saved("", 2, { checksPlan: { commands: [{ command: "npm test", cwd: "." }] }, checksReport: {
    results: [{ command: "npm test", cwd: ".", status: "passed", output: "Passed" }],
  } }, { checksPlan: "1", checksReport: "2" });
  const items = checkpointMessages([selection, report], false);
  assert.equal(items.filter((item) => item.kind === "tool").length, 1);
  const done = items.find((item) => item.kind === "tool");
  assert.equal(done?.kind === "tool" && done.call.status, "done");
});

test("durable pending tool results survive cancellation before the next full checkpoint", () => {
  const tuple = saved("coder", 1, { messages: [new AIMessage({ id: "reply", content: "", tool_calls: [
    { id: "a", name: "read_file", args: { path: "/a" } },
  ] })] });
  tuple.pendingWrites = [["tool-task", "messages", [new ToolMessage({ content: "Already completed", tool_call_id: "a" })]]];
  const item = checkpointMessages([tuple], false).find((entry) => entry.kind === "tool");
  assert.equal(item?.kind === "tool" && item.call.status, "done");
});

test("human approval/answer content includes context and author", () => {
  assert.equal(replyMessage({ answers: ["Yes"] }, { kind: "questions", from: "planner", questions: ["Ship it?"] }, "luca").content, "Ship it?\nYes");
  const reply = replyMessage({ decisions: [{ type: "reject", message: "No installs" }] },
    { kind: "approve_commands", commands: [{ tool: "run_command", command: "npm install" }] }, "luca");
  assert.equal(reply.username, "luca");
  assert.equal(reply.content, "Rejected: npm install\nNo installs");
});

test("SQLite round-trip preserves messages across namespaces after reopening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-messages-"));
  const path = join(dir, "checkpoints.sqlite");
  let saver = SqliteSaver.fromConnString(path);
  const tuples = [saved("", 1, { humanMessages: [humanMessage("Human note", "luca")] }),
    saved("planner", 2, { messages: [new AIMessage({ id: "reply", content: "Saved response", tool_calls: [{ id: "read", name: "read_file", args: { path: "/a" } }] }),
      new ToolMessage({ content: "Saved result", tool_call_id: "read" })] })];
  try {
    for (const tuple of tuples) await saver.put(tuple.config, tuple.checkpoint, { source: "loop", step: 1, parents: {} });
    saver.db.close();
    saver = SqliteSaver.fromConnString(path);
    const restored = [];
    for await (const tuple of saver.list({ configurable: { thread_id: "test" } })) restored.push(tuple);
    const items = checkpointMessages(restored, false);
    assert.ok(items.some((item) => item.kind === "message" && item.message.role === "user" && item.message.content === "Human note"));
    assert.ok(items.some((item) => item.kind === "tool" && item.result === "Saved result"));
  } finally { saver.db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("real nested agent checkpoints are readable across fresh invocations and human Command updates", async () => {
  class Model extends BaseChatModel {
    _llmType() { return "timeline-test"; }
    bindTools() { return this; }
    async _generate(messages: import("@langchain/core/messages").BaseMessage[]) {
      const afterTool = ToolMessage.isInstance(messages.at(-1));
      const message = new AIMessage({ content: afterTool ? "Finished inspection" : "Inspecting", tool_calls: [{
        name: afterTool ? "submit_review" : "read_file", args: afterTool ? { summary: "Reviewed" } : { path: "/index.ts" }, id: `call-${messages.length}`,
      }] });
      return { generations: [{ text: "", message }] };
    }
  }
  const saver = new MemorySaver();
  const state = Annotation.Root({ review: Annotation<unknown>(), humanMessages: Annotation<ReturnType<typeof humanMessage>[]>({ reducer: (a, b) => a.concat(b), default: () => [] }) });
  const graph = new StateGraph(state).addNode("reviewer", async () => {
    const agent = createAgent({ model: new Model({}), tools: [tool(async () => "file contents", { name: "read_file", description: "Read file", schema: z.object({ path: z.string() }) })],
      responseFormat: toolStrategy(z.object({ summary: z.string() }).meta({ title: "submit_review" })) });
    let result: unknown;
    for await (const value of await agent.stream({ messages: [{ role: "user", content: "INTERNAL CONTEXT" }] }, { streamMode: "values", durability: "sync" })) result = value;
    return { review: (result as { structuredResponse: unknown }).structuredResponse };
  }).addNode("approve", () => { interrupt("Approve?"); return {}; })
    .addEdge(START, "reviewer").addEdge("reviewer", "approve").addEdge("approve", END).compile({ checkpointer: saver });
  const config = { configurable: { thread_id: "nested" }, durability: "sync" as const };
  await graph.invoke({ humanMessages: [humanMessage("Start", "luca")] }, config);
  await graph.invoke(new Command({ resume: true, update: { humanMessages: [humanMessage("Approved", "luca")] } }), config);
  await graph.invoke({}, config);
  const checkpoints = [];
  for await (const tuple of saver.list(config)) checkpoints.push(tuple);
  const items = checkpointMessages(checkpoints, false);
  assert.equal(items.filter((item) => item.kind === "tool").length, 2);
  assert.equal(items.filter((item) => item.kind === "document").length, 2);
  assert.equal(items.filter((item) => item.kind === "message" && item.message.role === "user").length, 4);
  assert.equal(items.filter((item) => item.kind === "message" && item.message.role === "user" && item.message.username === "Coordinator").length, 2);
  assert.ok(JSON.stringify(items).includes("INTERNAL CONTEXT"));
  assert.ok(items.some((item) => item.kind === "tool" && item.result === "file contents"));
});
