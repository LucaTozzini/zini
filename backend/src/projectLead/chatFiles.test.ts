import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { userMessage } from "./messageInput.js";
import { chatAttachments, chatFilesMiddleware, messageFiles } from "./chatFiles.js";

const image = "data:image/png;base64,iVBORw0KGgo=";
const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4").toString("base64")}`;
const markdown = `data:text/markdown;base64,${Buffer.from("# Spec").toString("base64")}`;

const message = (id: string, ...args: Parameters<typeof userMessage>) => {
  const sent = userMessage(...args);
  sent.id = id;
  return sent;
};

test("attachments are numbered across the chat, compacted messages first, images named by number", () => {
  const compacted = [message("a", "mockup", [image], "alice")];
  const messages = [
    new AIMessage({ id: "b", content: "Looks good" }),
    message("c", "specs", [], "alice", [
      { name: "spec.pdf", data: pdf },
      { name: "notes.md", data: markdown },
    ]),
  ];
  const attachments = chatAttachments([...compacted, ...messages]);
  assert.deepEqual(
    attachments.map(({ number, name, type }) => ({ number, name, type })),
    [
      { number: 1, name: "image-1.png", type: "image/png" },
      { number: 2, name: "spec.pdf", type: "application/pdf" },
      { number: 3, name: "notes.md", type: "text/markdown" },
    ],
  );
  assert.deepEqual(messageFiles(messages[1]!), [
    { name: "spec.pdf", type: "application/pdf" },
    { name: "notes.md", type: "text/markdown" },
  ]);
});

test("the model sees each attachment labelled, text files as text, and the list of every one", async () => {
  const compacted = [message("a", "mockup", [image], "alice")];
  const messages = [
    message("c", "specs", [], "alice", [
      { name: "spec.pdf", data: pdf },
      { name: "notes.md", data: markdown },
    ]),
  ];
  let seen: { messages: BaseMessage[]; systemMessage: SystemMessage } | undefined;
  const wrap = chatFilesMiddleware.wrapModelCall as unknown as (request: object, handler: (request: never) => unknown) => unknown;
  await wrap({ state: { compacted, messages }, messages, systemMessage: new SystemMessage("Prompt") }, (request) => {
    seen = request;
    return new AIMessage("ok");
  });
  assert.deepEqual(seen!.messages[0]!.content, [
    { type: "text", text: "specs" },
    { type: "text", text: "[file 2: spec.pdf (application/pdf)]" },
    (messages[0]!.content as object[])[1],
    { type: "text", text: "[file 3: notes.md (text/markdown)]\n# Spec" },
  ]);
  // The compacted image is still listed, so it can still be uploaded.
  assert.match(seen!.systemMessage.text, /\[file 1: image-1\.png \(image\/png\)\]\n\[file 2: spec\.pdf/);
});

test("a chat without attachments goes to the model unchanged", async () => {
  const messages = [new HumanMessage({ id: "a", content: "hi" })];
  const request = { state: { messages }, messages, systemMessage: new SystemMessage("Prompt") };
  const wrap = chatFilesMiddleware.wrapModelCall as unknown as (
    request: object,
    handler: (request: object) => unknown,
  ) => unknown;
  await wrap(request, (seen) => assert.equal(seen, request));
});
