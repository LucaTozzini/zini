import type { Response } from "express";
import type { ServerEvent } from "shared";

// Server-sent events on GET /api/events: small "this changed" signals (a chat, a
// workspace's setup), after which the webapp refetches whatever changed.

const clients = new Set<Response>();

export function sendEvent(event: ServerEvent) {
  for (const res of clients) res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// Keeps res open as an event stream until the client disconnects. A comment every
// 25s stops proxies from closing it for being idle.
export function subscribe(res: Response) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  clients.add(res);

  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25_000);
  res.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}
