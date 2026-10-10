import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { realpath, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { chromium } from "playwright";
import { WorkspaceAppRuntime, availableAppPort, type AppLaunchPlan } from "../backend/src/workspaces/localAppRuntime.js";
import { killTree } from "../backend/src/core/processes.js";

const token = process.env.WORKSPACE_TOKEN;
if (!token) throw new Error("Missing workspace gateway token");
const issue = process.env.WORKSPACE_ID!;
delete process.env.WORKSPACE_TOKEN;
delete process.env.WORKSPACE_ID;
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "safe.directory";
process.env.GIT_CONFIG_VALUE_0 = "/workspace";
await mkdir("/state/home", { recursive: true });
async function cwd(_issue: string, path = ".") {
  const root = await realpath("/workspace");
  const target = await realpath(resolve(root, path));
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split("/").includes(".git")) throw new Error("Working directory is outside the workspace");
  return target;
}
const apps = new WorkspaceAppRuntime(cwd);
let plan: AppLaunchPlan | null = null;
let launchAbort: AbortController | null = null;
let launchTask: Promise<unknown> | null = null;
type Proc = { child: ReturnType<typeof spawn>; output: string; read: number; exitCode: number | null; status: string; timedOut: boolean; done: Promise<void> };
const processes = new Map<string, Proc>();
let next = 1;
async function start(command: string, path = ".", timeout?: number) {
  const child = spawn(command, { cwd: await cwd(issue, path), shell: "/bin/sh", detached: true,
    env: { PATH: process.env.PATH, HOME: "/state/home", LANG: "C.UTF-8", CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "/workspace" } });
  const id = `p${next++}`;
  const proc: Proc = { child, output: "", read: 0, exitCode: null, status: "running", timedOut: false, done: Promise.resolve() };
  const append = (chunk: Buffer) => { proc.output = (proc.output + chunk.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")).slice(-200000); };
  child.stdout?.on("data", append); child.stderr?.on("data", append);
  proc.done = new Promise<void>((done) => {
    const timer = timeout ? setTimeout(() => { proc.timedOut = true; killTree(child); }, Math.min(1800, Math.max(1, timeout)) * 1000) : null;
    child.once("error", error => { append(Buffer.from(String(error))); });
    child.once("close", (code, signal) => { killTree(child); if (timer) clearTimeout(timer); proc.exitCode = code;
      proc.status = proc.timedOut ? "Timed out and stopped" : code === null ? `stopped (${signal})` : `exited with code ${code}`; done(); });
  });
  processes.set(id, proc); return id;
}
async function stop(id: string) {
  const proc = processes.get(id); if (!proc) return `Already stopped ${id}`;
  killTree(proc.child); await proc.done; processes.delete(id); return `Stopped ${id}`;
}
let browser: Awaited<ReturnType<typeof chromium.launchServer>> | null = null;
async function api(action: string, body: any) {
  switch (action) {
    case "health": return { ok: true, issue };
    case "port": return availableAppPort();
    case "start": return start(body.command, body.cwd, body.timeout);
    case "filesystem": return filesystem(body);
    case "file": return workspaceFile(body);
    case "result": { const proc = processes.get(body.id); if (!proc) throw new Error("Unknown process");
      return { exitCode: proc.exitCode, timedOut: proc.timedOut, status: proc.status, output: proc.output.slice(-8000) || "(no output)" }; }
    case "read": { const proc = processes.get(body.id); if (!proc) throw new Error("Unknown process");
      const output = proc.output.slice(proc.read); proc.read = proc.output.length; return `${body.id}: ${proc.status}\n\n${output.slice(-8000) || "(no new output)"}`; }
    case "stop": return stop(body.id);
    case "drain": await Promise.all([...processes.keys()].map(stop)); return { ok: true };
    case "http": { const url = new URL(body.url);
      if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || Number(url.port) === 7777) throw new Error("Only workspace loopback app URLs are allowed");
      const response = await fetch(url, { method: body.method, headers: body.headers, body: body.body, redirect: "manual", signal: AbortSignal.timeout(30000) });
      // Bound the response; an unbounded app stream must not fill gateway memory.
      let text = ""; const reader = response.body?.getReader();
      if (reader) { while (text.length < 8000) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); } await reader.cancel(); }
      return `${response.status} ${response.statusText}\nContent-Type: ${response.headers.get("content-type")}\n${response.headers.get("location") ? `Location: ${response.headers.get("location")}\n` : ""}\n${text.slice(0,8000)}`; }
    case "appStatus": return { ...apps.status(issue), plan };
    case "appLaunch": {
      if (launchTask) throw new Error("Preview launch is already in progress");
      plan = body.plan; launchAbort = new AbortController();
      launchTask = (async () => { await writeFile("/state/preview.json", JSON.stringify(plan)); return { ...await apps.launch(issue, plan!, launchAbort!.signal, body.timeout), plan }; })();
      try { return await launchTask; } finally { launchTask = null; launchAbort = null; }
    }
    case "appStop": launchAbort?.abort(); await launchTask?.catch(() => {}); plan = null; await writeFile("/state/preview.json", "null"); return apps.stop(issue);
    case "checkData": {
      if (!/^[a-f0-9]{64}\.json$/.test(body.file)) throw new Error("Invalid fixture filename");
      await mkdir("/state/checks", { recursive: true });
      if (body.content !== undefined) { try { await readFile(`/state/checks/${body.file}`); } catch { await writeFile(`/state/checks/${body.file}`, body.content); } }
      return `/state/checks/${body.file}`;
    }
    case "browser": browser ??= await chromium.launchServer({ host: "127.0.0.1", args: ["--no-sandbox"] }); return { ready: true };
    default: throw new Error("Unknown gateway operation");
  }
}
function proxy(req: any, client: any, head?: Buffer) {
  const path = req.url.slice(`/preview/${encodeURIComponent(issue)}`.length) || "/";
  const target = apps.previewTarget(issue, path);
  let upstreamUrl: URL;
  if (req.url === "/browser" && browser && head !== undefined) upstreamUrl = new URL(browser.wsEndpoint());
  else if (target) upstreamUrl = new URL(`http://127.0.0.1:${target.port}${target.path}`);
  else { client.end(head === undefined ? "Preview is not ready" : "HTTP/1.1 404 Not Found\r\n\r\n"); return; }
  const headers = { ...req.headers, host: upstreamUrl.host }; delete headers["x-workspace-token"];
  if (headers.origin) headers.origin = `http://${upstreamUrl.host}`;
  const upstream = request({ hostname: upstreamUrl.hostname, port: upstreamUrl.port, path: upstreamUrl.pathname + upstreamUrl.search, method: req.method, headers }, response => {
    if (head !== undefined) { response.resume(); client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); }
    else { client.writeHead(response.statusCode, response.headers); response.pipe(client); }
  });
  upstream.on("error", () => client.destroy());
  client.on("close", () => upstream.destroy());
  upstream.on("upgrade", (response, peer, extra) => {
    client.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k,v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
    if (extra.length) client.write(extra); if (head?.length) peer.write(head);
    peer.on("error", () => client.destroy()); client.on("error", () => peer.destroy());
    client.on("close", () => peer.destroy()); peer.on("close", () => client.destroy()); peer.pipe(client); client.pipe(peer);
  });
  if (head !== undefined) upstream.end(); else req.pipe(upstream);
}
const server = createServer(async (req, res) => {
  if (req.headers["x-workspace-token"] !== token) { res.writeHead(401).end(); return; }
  if (req.url?.startsWith(`/preview/${encodeURIComponent(issue)}/`)) { proxy(req, res); return; }
  try {
    if (req.method !== "POST") throw new Error("Use POST");
    let content = ""; for await (const chunk of req) { content += chunk; if (content.length > 1000000) throw new Error("Request too large"); }
    const result = await api(req.url!.slice(1), JSON.parse(content || "{}"));
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(result));
  } catch (error) { res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) })); }
});
server.on("upgrade", (req, socket, head) => {
  if (req.headers["x-workspace-token"] !== token || !(req.url === "/browser" || req.url?.startsWith(`/preview/${encodeURIComponent(issue)}/`))) { socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n"); return; }
  proxy(req, socket, head);
});
server.listen(7777, "0.0.0.0");
// Source/dependencies and the launch plan survive container recreation. Backend
// restarts simply reconnect to this gateway and its existing processes.
try { plan = JSON.parse(await readFile("/state/preview.json", "utf8")); if (plan) await apps.launch(issue, plan); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Preview recovery:", error); }
import { filesystem, workspaceFile } from "./workspaceFiles.js";
