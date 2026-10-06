import test from "node:test";
import assert from "node:assert/strict";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, Command, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { createAgent, humanInTheLoopMiddleware, tool, toolStrategy } from "langchain";
import { z } from "zod";

// Exercise the real nested checkpoint/approval behavior without a remote model.
test("invocation memory resumes approval once and starts fresh for the next implementation", async () => {
  const initialHistories: BaseMessage[][] = [];
  let executions = 0;
  class Model extends BaseChatModel {
    constructor() { super({}); }
    _llmType() { return "session-test"; }
    bindTools() { return this; }
    async _generate(messages: BaseMessage[]) {
      const afterTool = ToolMessage.isInstance(messages.at(-1));
      if (!afterTool) initialHistories.push([...messages]);
      const message = new AIMessage({ content: "", tool_calls: [{
        name: afterTool ? "submit_report" : "run_check",
        args: afterTool ? { passed: true } : {}, id: `call-${messages.length}`,
      }] });
      return { generations: [{ text: "", message }] };
    }
  }
  const model = new Model();
  const state = Annotation.Root({ report: Annotation<{ passed: boolean } | null>() });
  const graph = new StateGraph(state).addNode("tester", async () => {
    const agent = createAgent({ model,
      tools: [tool(async () => { executions++; return "passed"; }, { name: "run_check", description: "Run check", schema: z.object({}) })],
      responseFormat: toolStrategy(z.object({ passed: z.boolean() }).meta({ title: "submit_report" })),
      middleware: [humanInTheLoopMiddleware({ interruptOn: { run_check: { allowedDecisions: ["approve"] } } })],
    });
    const result = await agent.invoke({ messages: [{ role: "user", content: "Check this version" }] });
    return { report: result.structuredResponse };
  }).addEdge(START, "tester").addEdge("tester", END).compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: "test" } };
  await graph.invoke({ report: null }, config);
  assert.equal(executions, 0);
  const resume = () => graph.invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config);
  assert.deepEqual((await resume()).report, { passed: true });
  assert.equal(executions, 1);
  await graph.invoke({ report: null }, config);
  assert.deepEqual((await resume()).report, { passed: true });
  assert.equal(executions, 2);
  assert.equal(initialHistories.length, 2);
  assert.ok(initialHistories.every((messages) => !messages.some(ToolMessage.isInstance)));
});

// Without remember, an agent's memory lasts one call: a second call in the same node
// run starts fresh, so correcting a document passes the first call's messages back.
test("a correction continues from the first call's messages", async () => {
  const histories: BaseMessage[][] = [];
  class Model extends BaseChatModel {
    constructor() { super({}); }
    _llmType() { return "session-test"; }
    bindTools() { return this; }
    async _generate(messages: BaseMessage[]) {
      histories.push([...messages]);
      const message = new AIMessage({ content: "", tool_calls: [{
        name: "submit_report", args: { passed: histories.length > 1 }, id: `call-${histories.length}`,
      }] });
      return { generations: [{ text: "", message }] };
    }
  }
  const model = new Model();
  const state = Annotation.Root({ report: Annotation<{ passed: boolean } | null>() });
  const graph = new StateGraph(state).addNode("tester", async () => {
    const run = (messages: (BaseMessage | { role: string; content: string })[]) => createAgent({ model, tools: [],
      responseFormat: toolStrategy(z.object({ passed: z.boolean() }).meta({ title: "submit_report" })),
    }).invoke({ messages });
    const first = await run([{ role: "user", content: "Check this version" }]);
    const second = await run([...first.messages, { role: "user", content: "That report was invalid: correct it" }]);
    return { report: second.structuredResponse };
  }).addEdge(START, "tester").addEdge("tester", END).compile({ checkpointer: new MemorySaver() });
  const result = await graph.invoke({ report: null }, { configurable: { thread_id: "test" } });
  assert.deepEqual(result.report, { passed: true });
  const second = histories[1]!;
  assert.equal(second.filter((message) => message.text === "Check this version").length, 1);
  assert.ok(second.some((message) => AIMessage.isInstance(message) && message.tool_calls?.[0]?.name === "submit_report"));
  assert.equal(second.at(-1)!.text, "That report was invalid: correct it");
});
