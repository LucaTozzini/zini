import { MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_BYTES } from "shared";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

export function userMessage(message: string, images: string[], username: string | null) {
  return new HumanMessage({
    content: images.length
      ? [{ type: "text", text: message }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
      : message,
    additional_kwargs: { username },
  });
}

export function withSenderName(message: BaseMessage): BaseMessage {
  const username = message.additional_kwargs.username;
  if (message.type !== "human" || typeof username !== "string") return message;
  return new HumanMessage({
    id: message.id,
    content:
      typeof message.content === "string"
        ? `[${username}]: ${message.text}`
        : [
            { type: "text", text: `[${username}]: ${message.text}` },
            ...message.content.filter((block) => typeof block !== "string" && block.type !== "text"),
          ],
    additional_kwargs: message.additional_kwargs,
  });
}

// A chat message from the webapp: text, base64 images (PNG, JPEG, WebP or GIF), or both.
const IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;
const image = z
  .string({ error: "Images must be base64 data URLs." })
  .refine((url) => {
    const data = IMAGE.exec(url)?.[2];
    return data !== undefined && data.length % 4 === 0;
  }, "Use base64 PNG, JPEG, WebP or GIF images.")
  .refine(
    (url) => Buffer.byteLength(url.slice(url.indexOf(",") + 1), "base64") <= MAX_CHAT_IMAGE_BYTES,
    "Images must be 5 MB or smaller.",
  );
export const messageInput = z
  .object({
    message: z.string({ error: "message must be text" }),
    images: z
      .array(image, { error: `Attach up to ${MAX_CHAT_IMAGES} images.` })
      .max(MAX_CHAT_IMAGES, `Attach up to ${MAX_CHAT_IMAGES} images.`)
      .default([]),
  })
  .refine((input) => Boolean(input.message.trim() || input.images.length), "message or images are required");

export const parseMessageInput = (body: unknown) => messageInput.parse(body);
