import test from "node:test";
import assert from "node:assert/strict";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { createAgent, toolStrategy } from "langchain";
import { z } from "zod";
import { requireSubmission } from "./submission.js";

// A model that answers in plain text the first `talks` times, then submits.
function model(talks: number) {
  const histories: BaseMessage[][] = [];
  class Model extends BaseChatModel {
    constructor() { super({}); }
    _llmType() { return "submission-test"; }
    bindTools() { return this; }
    async _generate(messages: BaseMessage[]) {
      histories.push([...messages]);
      const message = histories.length > talks
        ? new AIMessage({ content: "", tool_calls: [{ name: "submit_report", args: { done: true }, id: `call-${histories.length}` }] })
        : new AIMessage("I'm done.");
      return { generations: [{ text: "", message }] };
    }
  }
  return { model: new Model(), histories };
}

const agent = (chat: BaseChatModel, nudges: number[]) => createAgent({
  model: chat, tools: [],
  responseFormat: toolStrategy(z.object({ done: z.boolean() }).meta({ title: "submit_report" })),
  middleware: [requireSubmission("submit_report", async (attempt) => { nudges.push(attempt); })],
});

test("a reply without the document goes back to the model to submit it", async () => {
  const { model: chat, histories } = model(2);
  const nudges: number[] = [];
  const result = await agent(chat, nudges).invoke({ messages: [{ role: "user", content: "Report" }] });
  assert.deepEqual(result.structuredResponse, { done: true });
  assert.deepEqual(nudges, [1, 2]);
  assert.equal(histories.length, 3);
  assert.match(histories[2]!.at(-1)!.text, /Call submit_report/);
});

test("a third reply without the document ends the run", async () => {
  const { model: chat } = model(3);
  await assert.rejects(agent(chat, []).invoke({ messages: [{ role: "user", content: "Report" }] }), /three times without calling submit_report/);
});
