import { request as httpRequest, type RequestOptions, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

// Self-signed certificates are allowed only on workspace loopback endpoints.
export async function localRequest(url: URL, options: RequestOptions, response?: (response: IncomingMessage) => void) {
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Only loopback HTTP(S) endpoints are allowed");
  if (url.protocol === "http:") return httpRequest(url, options, response);
  return httpsRequest(url, { ...options, rejectUnauthorized: false }, response);
}
export async function localResponse(url: URL, options: RequestOptions, body?: string) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    void localRequest(url, options, resolve).then((request) => {
      request.on("error", reject);
      request.end(body);
    }, reject);
  });
}
