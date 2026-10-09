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
  let buffered = "";
  function event(frame: string): string {
    const lines = frame.split(/\r?\n/);
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return frame;
    let value;
    try { value = JSON.parse(data); } catch { return frame; }
    if (value?.type === "response.output_item.done" && Number.isInteger(value.output_index) && value.item) {
      items.set(value.output_index, value.item);
    }
    if ((value?.type === "response.completed" || value?.type === "response.incomplete") &&
      Array.isArray(value.response?.output) && value.response.output.length === 0 && items.size) {
      value.response.output = [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
      return [...lines.filter((line) => !line.startsWith("data:")), `data: ${JSON.stringify(value)}`].join("\n");
    }
    return frame;
  }
  const stream = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, string>({
    transform(chunk, controller) {
      buffered += chunk;
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffered))) {
        controller.enqueue(event(buffered.slice(0, boundary.index)) + "\n\n");
        buffered = buffered.slice(boundary.index + boundary[0].length);
      }
    },
    flush(controller) {
      if (buffered) controller.enqueue(event(buffered));
    },
  })).pipeThrough(new TextEncoderStream());
  const headers = new Headers(response.headers);
  if (!contentType) headers.set("content-type", "text/event-stream");
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}
