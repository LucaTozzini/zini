import assert from "node:assert/strict";
import test from "node:test";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { preserveChatGptOutput } from "./chatgptStream.js";

function sse(events: unknown[], splitBytes = false, contentType = true) {
  const bytes = new TextEncoder().encode(events.map((value) => `data: ${JSON.stringify(value)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n");
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      if (splitBytes) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      else controller.enqueue(bytes);
      controller.close();
    },
  }), { headers: contentType ? { "content-type": "text/event-stream" } : {} });
}

const items = [
  { type: "reasoning", id: "rs_one", summary: [], encrypted_content: "first-opaque-blob==" },
  { type: "message", id: "msg_one", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Checking", annotations: [] }] },
  { type: "reasoning", id: "rs_two", summary: [], encrypted_content: "second-opaque-blob==" },
  { type: "function_call", id: "fc_one", call_id: "call_one", name: "inspect", arguments: '{"path":"file"}', status: "completed" },
];
const response = { id: "resp_test", model: "gpt-5.6-sol", object: "response", status: "completed", output: [],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };

test("reasoning and tool calls survive headerless ChatGPT streaming, SQLite checkpoints, and replay", async () => {
  const events: unknown[] = [{ type: "response.created", response: { ...response, status: "in_progress" } }];
  items.forEach((item, output_index) => {
    events.push({ type: "response.output_item.added", output_index, item: { ...item, encrypted_content: undefined } });
    if (item.type === "message") events.push({ type: "response.output_text.delta", output_index, content_index: 0, item_id: item.id, delta: "Checking" });
    events.push({ type: "response.output_item.done", output_index, item });
  });
  events.push({ type: "response.completed", response });
  const requests: { input: unknown[] }[] = [];
  const model = new ChatOpenAI({ model: response.model, apiKey: "test", useResponsesApi: true, streaming: true, zdrEnabled: true,
    configuration: { fetch: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string));
      return preserveChatGptOutput(sse(events, true, false));
    } },
  });
  const saver = SqliteSaver.fromConnString(":memory:");
  const state = Annotation.Root({ messages: Annotation<BaseMessage[]>() });
  const graph = new StateGraph(state).addNode("model", async ({ messages }) => ({ messages: [await model.invoke(messages)] }))
    .addEdge(START, "model").addEdge("model", END).compile({ checkpointer: saver });
  const config = { configurable: { thread_id: "stream-test" }, durability: "sync" as const };
  try {
    await graph.invoke({ messages: [new HumanMessage("inspect")] }, config);
    const saved = await graph.getState(config);
    const message = saved.values.messages[0];
    assert.deepEqual(message.response_metadata.output, items);
    assert.equal(message.text, "Checking");
    assert.equal(message.tool_calls[0].id, "call_one");
    await model.invoke(saved.values.messages);
    assert.deepEqual(requests[1]!.input, items);
  } finally { saver.db.close(); }
});

test("the adapter handles split UTF-8 and CRLF, sorts output indexes, and restores incomplete responses", async () => {
  const output = [{ type: "message", id: "msg", content: [{ type: "output_text", text: "héllo 🌍" }] }, items[0]];
  const result = await preserveChatGptOutput(sse([
    { type: "response.output_item.done", output_index: 1, item: output[1] },
    { type: "response.output_item.done", output_index: 0, item: output[0] },
    { type: "response.incomplete", response: { output: [] } },
  ], true)).text();
  const terminal = result.split("\n\n").find((frame) => frame.includes('"response.incomplete"'))!;
  assert.deepEqual(JSON.parse(terminal.slice(6)).response.output, output);
});

test("nonempty completed output is authoritative and HTTP errors pass through", async () => {
  const original = [{ type: "reasoning", id: "authoritative", summary: [], encrypted_content: "original" }];
  const result = await preserveChatGptOutput(sse([
    { type: "response.output_item.done", output_index: 0, item: items[0] },
    { type: "response.completed", response: { output: original } },
  ])).text();
  const terminal = result.split("\n\n").find((frame) => frame.includes('"response.completed"'))!;
  assert.deepEqual(JSON.parse(terminal.slice(6)).response.output, original);
  const error = Response.json({ error: "invalid reasoning" }, { status: 400 });
  assert.equal(preserveChatGptOutput(error), error);
});

test("stream cancellation reaches the upstream response", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }),
    { headers: { "content-type": "text/event-stream" } });
  await preserveChatGptOutput(response).body!.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});
