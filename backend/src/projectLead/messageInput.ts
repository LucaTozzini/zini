import { MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_BYTES, type ProjectLeadMessage } from "shared";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

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

export function parseMessageInput(body: unknown): ProjectLeadMessage {
  if (!body || typeof body !== "object") throw new Error("message is required");
  const { message, images = [] } = body as Record<string, unknown>;
  if (typeof message !== "string") throw new Error("message must be text");
  if (!Array.isArray(images) || images.length > MAX_CHAT_IMAGES) throw new Error(`Attach up to ${MAX_CHAT_IMAGES} images.`);
  for (const image of images) {
    if (typeof image !== "string") throw new Error("Images must be base64 data URLs.");
    const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match || match[2]!.length % 4 !== 0) throw new Error("Use base64 PNG, JPEG, WebP or GIF images.");
    if (Buffer.byteLength(match[2]!, "base64") > MAX_CHAT_IMAGE_BYTES) throw new Error("Images must be 5 MB or smaller.");
  }
  if (!message.trim() && !images.length) throw new Error("message or images are required");
  return { message, images };
}
