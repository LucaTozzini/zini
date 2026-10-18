import { EventSourceParserStream, type EventSourceMessage } from "eventsource-parser/stream";

// Some ChatGPT streams finish with an empty response.output. LangChain then
// replays its merged reasoning field, which concatenates separate encrypted
// items. Restore the completed output from the stream's authoritative items.
export function preserveChatGptOutput(response: Response): Response {
  // The ChatGPT endpoint can omit Content-Type even for a valid SSE stream.
  // This adapter is used only by our streaming ChatGPT Responses client.
  const contentType = response.headers.get("content-type");
  if (!response.ok || !response.body || (contentType && !contentType.includes("text/event-stream"))) {
    return response;
  }
  const items = new Map<number, Record<string, unknown>>();
  // An event's data, with the completed response's output restored if it came back empty.
  function restored(data: string): string {
    let value;
    try {
      value = JSON.parse(data);
    } catch {
      return data;
    }
    if (value?.type === "response.output_item.done" && Number.isInteger(value.output_index) && value.item) {
      items.set(value.output_index, value.item);
    }
    if (
      (value?.type === "response.completed" || value?.type === "response.incomplete") &&
      Array.isArray(value.response?.output) &&
      value.response.output.length === 0 &&
      items.size
    ) {
      value.response.output = [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
      return JSON.stringify(value);
    }
    return data;
  }
  // The event as SSE again, for LangChain's client to read.
  const frame = ({ event, id, data }: EventSourceMessage) =>
    `${event ? `event: ${event}\n` : ""}${id ? `id: ${id}\n` : ""}${restored(data)
      .split("\n")
      .map((line) => `data: ${line}\n`)
      .join("")}\n`;
  const stream = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .pipeThrough(
      new TransformStream<EventSourceMessage, string>({ transform: (event, controller) => controller.enqueue(frame(event)) }),
    )
    .pipeThrough(new TextEncoderStream());
  const headers = new Headers(response.headers);
  if (!contentType) headers.set("content-type", "text/event-stream");
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}
