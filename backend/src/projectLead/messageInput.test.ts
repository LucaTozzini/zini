import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CHAT_IMAGE_BYTES } from "shared";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { parseMessageInput, projectLeadMessageInput, userMessage, withSenderName } from "./messageInput.js";
import { fileContent } from "../agents/linearFileTools.js";
import { chatModel } from "../providers/modelProvider.js";

const image = "data:image/png;base64,iVBORw0KGgo=";

test("message input accepts text, images with text, and images alone", () => {
  assert.deepEqual(parseMessageInput({ message: "hello" }), { message: "hello", images: [] });
  assert.deepEqual(parseMessageInput({ message: "describe", images: [image] }), { message: "describe", images: [image] });
  assert.deepEqual(parseMessageInput({ message: "", images: [image] }), { message: "", images: [image] });
});

test("message input rejects empty, malformed, unsupported and oversized attachments", () => {
  for (const body of [
    null,
    {},
    { message: " " },
    { message: "", images: "invalid" },
    { message: "", images: ["https://example.com/image.png"] },
    { message: "", images: ["data:image/svg+xml;base64,PHN2Zz4="] },
    { message: "", images: ["data:image/png;base64,abc"] },
    { message: "", images: Array(5).fill(image) },
    { message: "", images: [`data:image/png;base64,${Buffer.alloc(MAX_CHAT_IMAGE_BYTES + 1).toString("base64")}`] },
  ])
    assert.throws(() => parseMessageInput(body));
});

test("sender prefix preserves images and both providers receive image inputs", async (t) => {
  const original = userMessage("describe", [image], "alice");
  const named = withSenderName(original);
  assert.equal(original.text, "describe");
  assert.equal(named.text, "[alice]: describe");
  const requests: { messages?: { content: unknown }[]; input?: { content: unknown }[] }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return Response.json({ error: { message: "Captured request" } }, { status: 400 });
  });
  await assert.rejects(
    chatModel({ provider: "openrouter", key: "test" }, "test", { maxRetries: 0 }).invoke([named]),
    /Captured request/,
  );
  assert.deepEqual(requests[0]?.messages?.[0]?.content, [
    { type: "text", text: "[alice]: describe" },
    { type: "image_url", image_url: { url: image } },
  ]);
  await assert.rejects(
    chatModel({ provider: "chatgpt", token: async () => "test" }, "test", { maxRetries: 0 }).invoke([named]),
    /Captured request/,
  );
  assert.deepEqual(requests[1]?.input?.[0]?.content, [
    { type: "input_text", text: "[alice]: describe" },
    { type: "input_image", image_url: image },
  ]);
});

const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.4").toString("base64")}`;

test("the Project Lead's input also takes PDF and text files, and nothing else", () => {
  const files = [
    { name: "spec.pdf", data: pdf },
    { name: "notes.md", data: `data:text/markdown;base64,${Buffer.from("# Notes").toString("base64")}` },
  ];
  assert.deepEqual(projectLeadMessageInput.parse({ message: "", files }), { message: "", images: [], files });
  for (const body of [
    { message: "", files: [{ name: "a.zip", data: "data:application/zip;base64,UEs=" }] },
    { message: "", files: [{ name: " ", data: pdf }] },
    { message: "", files: Array(5).fill({ name: "spec.pdf", data: pdf }) },
  ])
    assert.throws(() => projectLeadMessageInput.parse(body));
  // The Forge's chat takes images only.
  assert.deepEqual(parseMessageInput({ message: "hi", files: [{ name: "spec.pdf", data: pdf }] }), { message: "hi", images: [] });
});

test("both providers receive an attached PDF, and a PDF a tool returned", async (t) => {
  const message = withSenderName(userMessage("read this", [], "alice", [{ name: "spec.pdf", data: pdf }]));
  const call = new AIMessage({ content: "", tool_calls: [{ id: "call_1", name: "get_linear_file", args: {} }] });
  const result = new ToolMessage({
    tool_call_id: "call_1",
    content: fileContent("spec.pdf", "application/pdf", Buffer.from("%PDF-1.4")) as never,
  });
  const requests: {
    messages?: { role: string; content: unknown }[];
    input?: { type?: string; content?: unknown; output?: unknown }[];
  }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return Response.json({ error: { message: "Captured request" } }, { status: 400 });
  });
  await assert.rejects(
    chatModel({ provider: "openrouter", key: "test" }, "test", { maxRetries: 0 }).invoke([message, call, result]),
    /Captured request/,
  );
  const file = { type: "file", file: { filename: "spec.pdf", file_data: pdf } };
  assert.deepEqual(requests[0]?.messages?.[0]?.content, [{ type: "text", text: "[alice]: read this" }, file]);
  // Chat Completions takes only text in a tool result: the PDF follows it, from the user.
  assert.equal(requests[0]?.messages?.[2]?.role, "tool");
  assert.deepEqual((requests[0]?.messages?.[3]?.content as unknown[])[1], file);

  await assert.rejects(
    chatModel({ provider: "chatgpt", token: async () => "test" }, "test", { maxRetries: 0 }).invoke([message, call, result]),
    /Captured request/,
  );
  const input_file = { type: "input_file", file_data: pdf, filename: "spec.pdf" };
  assert.deepEqual(requests[1]?.input?.[0]?.content, [{ type: "input_text", text: "[alice]: read this" }, input_file]);
  const output = requests[1]?.input?.find((item) => item.type === "function_call_output")?.output as unknown[];
  assert.deepEqual(output[1], { type: "input_file", filename: "spec.pdf", file_data: pdf });
});
