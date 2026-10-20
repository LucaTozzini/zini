import type { LinearClient } from "@linear/sdk";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { createMiddleware, tool } from "langchain";
import { z } from "zod";
import { isSummary } from "../agents/compaction.js";
import { uploadLinearFile } from "../integrations/linear.js";

// A file the user attached to a chat message: an image, a PDF or a text file. data is
// base64. number counts every attachment in the chat from 1, in the order they were sent.
type Attachment = { number: number; name: string; type: string; data: string; messageId: string | undefined; index: number };

type Block = Record<string, unknown> & { type: string };
const blocks = (message: BaseMessage) => (Array.isArray(message.content) ? (message.content as Block[]) : []);

// The attachment a content block holds (images as data URLs, files as base64 file
// blocks, see userMessage), without its name for an image.
function attachmentOf(block: Block) {
  if (block.type === "image_url") {
    const image = block.image_url as string | { url?: string };
    const url = typeof image === "string" ? image : (image.url ?? "");
    const match = /^data:([^;]+);base64,(.*)$/.exec(url);
    return match ? { type: match[1]!, data: match[2]! } : null;
  }
  if (block.type === "file" && block.source_type === "base64") {
    const filename = (block.metadata as { filename?: string } | undefined)?.filename;
    return { name: filename, type: String(block.mime_type), data: String(block.data) };
  }
  return null;
}

// Every attachment in a chat's messages, compacted ones included. Images are named by
// their number, as they come without a name.
export function chatAttachments(messages: BaseMessage[]): Attachment[] {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.type !== "human" || isSummary(message)) continue;
    if (message.id) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
    }
    let index = 0;
    for (const block of blocks(message)) {
      const found = attachmentOf(block);
      if (!found) continue;
      const number = attachments.length + 1;
      const name =
        "name" in found && found.name
          ? found.name
          : `image-${number}.${found.type.split("/")[1] === "jpeg" ? "jpg" : found.type.split("/")[1]}`;
      attachments.push({ number, name, type: found.type, data: found.data, messageId: message.id, index: index++ });
    }
  }
  return attachments;
}

// The files attached to a user's message, as the chat shows them.
export const messageFiles = (message: BaseMessage) =>
  blocks(message).flatMap((block) => {
    if (block.type !== "file") return [];
    const found = attachmentOf(block);
    return found && "name" in found ? [{ name: found.name ?? "file", type: found.type }] : [];
  });

const label = ({ number, name, type }: Attachment) => `[file ${number}: ${name} (${type})]`;

// What the model sees of a message with attachments: each one labelled with its number,
// text files as their text.
function labelled(message: BaseMessage, numbered: Map<string, Attachment>) {
  let index = 0;
  const content = blocks(message).flatMap((block): Block[] => {
    if (!attachmentOf(block)) return [block];
    const attachment = numbered.get(`${message.id}:${index++}`);
    if (!attachment) return [block];
    if (attachment.type.startsWith("text/") || attachment.type === "application/json")
      return [{ type: "text", text: `${label(attachment)}\n${Buffer.from(attachment.data, "base64").toString("utf8")}` }];
    return [{ type: "text", text: label(attachment) }, block];
  });
  return new HumanMessage({ id: message.id, content: content as never, additional_kwargs: message.additional_kwargs });
}

// Numbers the files attached in the chat, and lists them in every model call, so the
// model can still upload one after the message it came in is compacted away.
export const chatFilesMiddleware = createMiddleware({
  name: "ChatFiles",
  wrapModelCall: (request, handler) => {
    const state = request.state as unknown as { messages: BaseMessage[]; compacted?: BaseMessage[] };
    const attachments = chatAttachments([...(state.compacted ?? []), ...state.messages]);
    if (!attachments.length) return handler(request);
    const numbered = new Map(attachments.map((attachment) => [`${attachment.messageId}:${attachment.index}`, attachment]));
    return handler({
      ...request,
      messages: request.messages.map((message) =>
        message.type === "human" && blocks(message).some(attachmentOf) ? labelled(message, numbered) : message,
      ),
      systemMessage: request.systemMessage.concat(
        `\n\n# Files attached in this chat\n\n${attachments.map(label).join("\n")}\n\n` +
          "upload_file uploads one to Linear, e.g. to add it to an issue.",
      ),
    });
  },
});

export function uploadFileTool(linear: LinearClient) {
  return tool(
    async ({ file }, config) => {
      const { state } = config as unknown as { state: { messages: BaseMessage[]; compacted?: BaseMessage[] } };
      const attachment = chatAttachments([...(state.compacted ?? []), ...state.messages]).find((a) => a.number === file);
      if (!attachment) throw new Error(`There's no file ${file} in this chat`);
      const { name, type, data } = attachment;
      const url = await uploadLinearFile(linear, name, type, Buffer.from(data, "base64"));
      return JSON.stringify({ name, url, markdown: type.startsWith("image/") ? `![${name}](${url})` : `[${name}](${url})` });
    },
    {
      name: "upload_file",
      description:
        "Upload a file the user attached in this chat to Linear, by its number ([file 2: ...] is 2). Returns its URL and the " +
        "markdown that shows it. Uploading alone doesn't attach it anywhere: put the markdown in an issue's description " +
        "with create_issue or update_issue.",
      schema: z.object({ file: z.number().int().min(1) }),
    },
  );
}
