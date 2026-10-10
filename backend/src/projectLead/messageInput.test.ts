import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CHAT_IMAGE_BYTES } from "shared";
import { parseMessageInput, userMessage, withSenderName } from "./messageInput.js";
import { chatModel } from "../providers/modelProvider.js";

const image = "data:image/png;base64,iVBORw0KGgo=";

test("message input accepts text, images with text, and images alone", () => {
  assert.deepEqual(parseMessageInput({ message: "hello" }), { message: "hello", images: [] });
  assert.deepEqual(parseMessageInput({ message: "describe", images: [image] }), { message: "describe", images: [image] });
  assert.deepEqual(parseMessageInput({ message: "", images: [image] }), { message: "", images: [image] });
});

test("message input rejects empty, malformed, unsupported and oversized attachments", () => {
  for (const body of [null, {}, { message: " " }, { message: "", images: "invalid" },
    { message: "", images: ["https://example.com/image.png"] },
    { message: "", images: ["data:image/svg+xml;base64,PHN2Zz4="] },
    { message: "", images: ["data:image/png;base64,abc"] },
    { message: "", images: Array(5).fill(image) },
    { message: "", images: [`data:image/png;base64,${Buffer.alloc(MAX_CHAT_IMAGE_BYTES + 1).toString("base64")}`] },
  ]) assert.throws(() => parseMessageInput(body));
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
  await assert.rejects(chatModel({ provider: "openrouter", key: "test" }, "test", { maxRetries: 0 }).invoke([named]), /Captured request/);
  assert.deepEqual(requests[0]?.messages?.[0]?.content, [
    { type: "text", text: "[alice]: describe" }, { type: "image_url", image_url: { url: image } },
  ]);
  await assert.rejects(chatModel({ provider: "chatgpt", token: async () => "test" }, "test", { maxRetries: 0 }).invoke([named]), /Captured request/);
  assert.deepEqual(requests[1]?.input?.[0]?.content, [
    { type: "input_text", text: "[alice]: describe" }, { type: "input_image", image_url: image },
  ]);
});
