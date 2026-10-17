import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, fakeModel } from "langchain";
import { modelStamp } from "./agents.js";

test("each saved reply records the model that wrote it", async () => {
  const agent = createAgent({
    model: fakeModel().respond(new AIMessage("First")).respond(new AIMessage("Second")) as never,
    tools: [],
    middleware: [modelStamp("fixture-model")],
    checkpointer: new MemorySaver(),
  });
  const config = { configurable: { thread_id: "stamp" } };
  await agent.invoke({ messages: [{ role: "user", content: "Hi" }] }, config);
  await agent.invoke({ messages: [{ role: "user", content: "Again" }] }, config);
  const { values } = await agent.graph.getState(config);
  const replies = (values.messages as AIMessage[]).filter(AIMessage.isInstance);
  assert.deepEqual(replies.map((reply) => [reply.text, reply.additional_kwargs.model]),
    [["First", "fixture-model"], ["Second", "fixture-model"]]);
});
