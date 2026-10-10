import { request, type IncomingHttpHeaders, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import type { RequestHandler } from "express";
import { previewBase } from "./workspaceAppRuntime.js";

type Target = { port: number; path: string; prefix: string; stripPrefix: boolean; token?: string; transportPath?: string; servicePort?: number };
type Runtime = { previewTarget: (issueId: string, path: string) => Target | null };
const HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

function headersWithoutHop(headers: IncomingHttpHeaders) {
  const result = { ...headers };
  for (const name of [...HOP_HEADERS, ...(headers.connection ?? "").split(",").map(name => name.trim().toLowerCase())]) delete result[name];
  return result;
}

function upstreamHeaders(req: IncomingMessage, target: Target, issueId: string, upgrade = false) {
  const headers = upgrade ? { ...req.headers } : headersWithoutHop(req.headers);
  const host = `127.0.0.1:${target.port}`;
  headers["x-forwarded-host"] = req.headers.host;
  headers["x-forwarded-proto"] = "encrypted" in req.socket ? "https" : "http";
  headers["x-forwarded-prefix"] = previewBase(issueId);
  headers.host = host;
  if (target.token) headers["x-workspace-token"] = target.token;
  // Dev servers check their loopback Host/Origin; the public address is available
  // through forwarded headers. Browser cookies stay scoped to the preview path.
  if (headers.origin) headers.origin = `http://${host}`;
  return headers;
}

function responseHeaders(headers: IncomingHttpHeaders, issueId: string, target: Target) {
  const result = headersWithoutHop(headers);
  const base = previewBase(issueId);
  if (result.location) {
    let location = result.location;
    try {
      const url = new URL(location);
      if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && Number(url.port) === (target.servicePort ?? target.port))
        location = `${url.pathname}${url.search}${url.hash}`;
    } catch { /* Relative redirect. */ }
    if (location.startsWith("/") && !location.startsWith("//") && location !== base && !location.startsWith(`${base}/`))
      location = `${base}${target.stripPrefix ? target.prefix : ""}${location}`;
    result.location = location;
  }
  if (result["set-cookie"]) result["set-cookie"] = result["set-cookie"].map(cookie => {
    const scoped = cookie.replace(/;\s*Domain=[^;]*/gi, "");
    return /;\s*Path=/i.test(scoped)
      ? scoped.replace(/;\s*Path=[^;]*/i, `; Path=${base}/`)
      : `${scoped}; Path=${base}/`;
  });
  return result;
}

function destination(runtime: Runtime, rawUrl: string) {
  const match = /^\/preview\/([^/?]+)(\/[^?]*)?(\?.*)?$/.exec(rawUrl);
  if (!match) return null;
  let issueId: string;
  try { issueId = decodeURIComponent(match[1]!); } catch { return null; }
  const target = runtime.previewTarget(issueId, `${match[2] || "/"}${match[3] || ""}`);
  return target ? { issueId, target, missingSlash: !match[2], query: match[3] ?? "" } : null;
}

// Mount before express.json: request bodies must reach the workspace unchanged.
export function workspacePreview(runtime: Runtime): RequestHandler {
  return (req, res, next) => {
    if (!req.url.startsWith("/preview/")) { next(); return; }
    const resolved = destination(runtime, req.url);
    if (!resolved) { res.status(404).send("This workspace preview is not running."); return; }
    const { issueId, target } = resolved;
    if (resolved.missingSlash) { res.redirect(308, `${previewBase(issueId)}/${resolved.query}`); return; }
    const upstream = request({ hostname: "127.0.0.1", port: target.port, path: target.transportPath ?? target.path,
      method: req.method, headers: upstreamHeaders(req, target, issueId) }, response => {
      res.writeHead(response.statusCode ?? 502, responseHeaders(response.headers, issueId, target));
      response.on("error", () => res.destroy());
      response.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.status(502).send("The workspace server is unavailable.");
      else res.destroy();
    });
    upstream.setTimeout(60_000, () => upstream.destroy(new Error("Workspace request timed out.")));
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
  };
}

export function workspacePreviewUpgrades(server: Server, runtime: Runtime) {
  server.on("upgrade", (req, client: Duplex, head) => {
    const resolved = destination(runtime, req.url ?? "");
    if (!resolved || resolved.missingSlash) { client.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return; }
    const { issueId, target } = resolved;
    const upstream = request({ hostname: "127.0.0.1", port: target.port, path: target.transportPath ?? target.path,
      method: req.method, headers: upstreamHeaders(req, target, issueId, true) });
    upstream.on("upgrade", (response, peer, upstreamHead) => {
      upstream.setTimeout(0);
      peer.setTimeout(0);
      const headers = Object.entries(response.headers).flatMap(([name, value]) =>
        value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(value => `${name}: ${value}`));
      client.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) peer.write(head);
      client.on("error", () => peer.destroy());
      peer.on("error", () => client.destroy());
      client.on("close", () => peer.destroy());
      peer.on("close", () => client.destroy());
      peer.pipe(client); client.pipe(peer);
    });
    upstream.on("response", response => {
      response.resume(); client.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);
    });
    upstream.on("error", () => client.destroy());
    upstream.setTimeout(10_000, () => upstream.destroy(new Error("Workspace WebSocket handshake timed out.")));
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
    upstream.end();
  });
}
