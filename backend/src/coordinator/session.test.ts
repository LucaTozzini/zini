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
