import { MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_BYTES, type ChatFile } from "shared";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

// Files go in as LangChain base64 file blocks, named in their metadata. Text files are
// turned into text only for the model (see chatFiles.ts), so the message keeps the file.
export function userMessage(message: string, images: string[], username: string | null, files: ChatFile[] = []) {
  return new HumanMessage({
    content:
      images.length || files.length
        ? [
            { type: "text", text: message },
            ...images.map((url) => ({ type: "image_url", image_url: { url } })),
            ...files.map(({ name, data }) => ({
              type: "file",
              source_type: "base64",
              mime_type: data.slice("data:".length, data.indexOf(";")),
              data: data.slice(data.indexOf(",") + 1),
              metadata: { filename: name },
            })),
          ]
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
const fields = {
  message: z.string({ error: "message must be text" }),
  images: z
    .array(image, { error: `Attach up to ${MAX_CHAT_IMAGES} images.` })
    .max(MAX_CHAT_IMAGES, `Attach up to ${MAX_CHAT_IMAGES} images.`)
    .default([]),
};
export const messageInput = z
  .object(fields)
  .refine((input) => Boolean(input.message.trim() || input.images.length), "message or images are required");

// The Project Lead's chat also takes files: PDFs and text files, as base64 data URLs.
const FILE = /^data:(application\/pdf|application\/json|text\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/;
const file = z.object({
  name: z.string().trim().min(1).max(200),
  data: z
    .string()
    .refine((url) => {
      const data = FILE.exec(url)?.[2];
      return data !== undefined && data.length % 4 === 0;
    }, "Attach PDF or text files.")
    .refine(
      (url) => Buffer.byteLength(url.slice(url.indexOf(",") + 1), "base64") <= MAX_CHAT_FILE_BYTES,
      "Files must be 10 MB or smaller.",
    ),
});
export const projectLeadMessageInput = z
  .object({
    ...fields,
    files: z
      .array(file, { error: `Attach up to ${MAX_CHAT_FILES} files.` })
      .max(MAX_CHAT_FILES, `Attach up to ${MAX_CHAT_FILES} files.`)
      .default([]),
  })
  .refine(
    (input) => Boolean(input.message.trim() || input.images.length || input.files.length),
    "message, images or files are required",
  );

export const parseMessageInput = (body: unknown) => messageInput.parse(body);
