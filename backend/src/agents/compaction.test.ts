import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent } from "langchain";
import { compactionMiddleware } from "./compaction.js";

test("compacted messages stay archived across the agent's later runs", async () => {
  const model = new FakeListChatModel({ responses: ["Noted."] });
  const agent = createAgent({
    model,
    tools: [],
    middleware: [compactionMiddleware(model, { compactAt: 10, keepMessages: 2 })],
    checkpointer: new MemorySaver(),
  });
  const config = { configurable: { thread_id: "compaction" } };
  const say = (id: string) => new HumanMessage({ id, content: `Message ${id}: ${"long enough to count. ".repeat(10)}` });

  // Each turn is a new run on the same thread, like a remembered Forge agent's rounds.
  for (const id of ["h1", "h2", "h3"]) await agent.invoke({ messages: [say(id)] }, config);

  const { values } = await agent.graph.getState(config);
  const archived = (values.compacted as BaseMessage[]).map((message) => message.id);
  assert.ok(archived.includes("h1"), `h1 was compacted in the second run and must survive the third: ${archived.join(", ")}`);
  assert.equal(new Set(archived).size, archived.length, "no message is archived twice");
});
