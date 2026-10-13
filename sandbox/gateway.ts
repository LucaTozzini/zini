import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createServer as createTcpServer } from "node:net";
import { realpath, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { chromium } from "playwright";
import { WorkspaceAppRuntime, availableAppPort, type AppLaunchPlan } from "../backend/src/workspaces/localAppRuntime.js";
import { killTree } from "../backend/src/core/processes.js";
import { generateDevelopmentTls } from "../backend/src/workspaces/developmentTls.js";
import { localRequest, localResponse } from "../backend/src/workspaces/localHttp.js";

const token = process.env.WORKSPACE_TOKEN;
if (!token) throw new Error("Missing workspace gateway token");
const issue = process.env.WORKSPACE_ID!;
delete process.env.WORKSPACE_TOKEN;
delete process.env.WORKSPACE_ID;
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = "safe.directory";
process.env.GIT_CONFIG_VALUE_0 = "/workspace";
await mkdir("/state/home", { recursive: true });
function validateEnvironment(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(key) || /^(PATH|HOME|SHELL|BASH_ENV|ENV|LD_.*|NODE_OPTIONS|NODE_PATH|PLAYWRIGHT_.*|GIT_.*|WORKSPACE_.*)$/.test(key) || typeof value !== "string" || value.length > 4096 || value.includes("\0")) throw new Error("Invalid environment configuration");
  }
}
let environment: Record<string, string> = {};
try { const saved = JSON.parse(await readFile("/state/environment.json", "utf8")); validateEnvironment(saved); environment = saved; } catch {}
Object.assign(process.env, environment);
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
type Proc = { child: ReturnType<typeof spawn>; output: string; read: number; exitCode: number | null; status: string; timedOut: boolean; quiet: boolean; done: Promise<void> };
const processes = new Map<string, Proc>();
let next = 1;
// stdin is closed: nothing can answer a prompt. With quiet, a command that prints nothing
// for that many seconds is stopped, as it's probably waiting for input.
async function start(command: string, path = ".", timeout?: number, quiet?: number) {
  const child = spawn(command, { cwd: await cwd(issue, path), shell: "/bin/sh", detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, HOME: "/state/home", LANG: "C.UTF-8", CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "/workspace", ...environment } });
  const id = `p${next++}`;
  const proc: Proc = { child, output: "", read: 0, exitCode: null, status: "running", timedOut: false, quiet: false, done: Promise.resolve() };
  let lastOutput = Date.now();
  const append = (chunk: Buffer) => { lastOutput = Date.now(); proc.output = (proc.output + chunk.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")).slice(-200000); };
  child.stdout?.on("data", append); child.stderr?.on("data", append);
  proc.done = new Promise<void>((done) => {
    const timer = timeout ? setTimeout(() => { proc.timedOut = true; killTree(child); }, Math.min(1800, Math.max(1, timeout)) * 1000) : null;
    const quietTimer = quiet ? setInterval(() => {
      if (!proc.quiet && Date.now() - lastOutput >= quiet * 1000) { proc.quiet = true; killTree(child); }
    }, 1000) : null;
    child.once("error", error => { append(Buffer.from(String(error))); });
    child.once("close", (code, signal) => { killTree(child); if (timer) clearTimeout(timer); if (quietTimer) clearInterval(quietTimer); proc.exitCode = code;
      proc.status = proc.timedOut ? "Timed out and stopped"
        : proc.quiet ? `Stopped after ${quiet} s without output: it may be waiting for input (its last output is below). Use its non-interactive option or arguments, or a longer quietSeconds if it's legitimately silent.`
        : code === null ? `stopped (${signal})` : `exited with code ${code}`; done(); });
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
    case "generateTls": {
      const paths = await generateDevelopmentTls();
      if (browser) { await browser.close(); browser = null; }
      return paths;
    }
    case "health": return { ok: true, issue };
    case "environment": {
      const values = body.values as Record<string, string>;
      validateEnvironment(values);
      for (const key of Object.keys(environment)) delete process.env[key];
      environment = values; Object.assign(process.env, values);
      await writeFile("/state/environment.json", JSON.stringify(environment), { mode: 0o600 });
      return { configured: Object.keys(environment) };
    }
    case "port": return availableAppPort();
    case "portFree": {
      const port = Number(body.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 7777) throw new Error("Invalid app port");
      await new Promise<void>((resolve, reject) => {
        const listener = createTcpServer(); listener.once("error", reject);
        listener.listen(port, "127.0.0.1", () => listener.close(error => error ? reject(error) : resolve()));
      });
      return { free: true };
    }
    case "start": return start(body.command, body.cwd, body.timeout, body.quiet);
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
      const response = await localResponse(url, { method: body.method, headers: body.headers, signal: AbortSignal.timeout(30000) }, body.body);
      // Bound the response; an unbounded app stream must not fill gateway memory.
      let text = "";
      for await (const chunk of response) { text += chunk.toString(); if (text.length >= 8000) break; }
      response.destroy();
      return `${response.statusCode} ${response.statusMessage}\nContent-Type: ${response.headers["content-type"]}\n${response.headers.location ? `Location: ${response.headers.location}\n` : ""}\n${text.slice(0,8000)}`; }
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
    case "browser": {
      browser ??= await chromium.launchServer({ host: "127.0.0.1", args: ["--no-sandbox"] }); return { ready: true };
    }
    default: throw new Error("Unknown gateway operation");
  }
}
async function proxy(req: any, client: any, head?: Buffer) {
  const path = req.url.slice(`/preview/${encodeURIComponent(issue)}`.length) || "/";
  const target = apps.previewTarget(issue, path);
  let upstreamUrl: URL;
  if (req.url === "/browser" && browser && head !== undefined) { upstreamUrl = new URL(browser.wsEndpoint()); upstreamUrl.protocol = "http:"; }
  else if (target) upstreamUrl = new URL(`${target.protocol}//127.0.0.1:${target.port}${target.path}`);
  else { client.end(head === undefined ? "Preview is not ready" : "HTTP/1.1 404 Not Found\r\n\r\n"); return; }
  const headers = { ...req.headers, host: upstreamUrl.host }; delete headers["x-workspace-token"];
  if (headers.origin) headers.origin = `${upstreamUrl.protocol}//${upstreamUrl.host}`;
  const upstream = await localRequest(upstreamUrl, { method: req.method, headers }, response => {
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
  if (req.url?.startsWith(`/preview/${encodeURIComponent(issue)}/`)) { void proxy(req, res).catch(() => res.destroy()); return; }
  try {
    if (req.method !== "POST") throw new Error("Use POST");
    let content = ""; for await (const chunk of req) { content += chunk; if (content.length > 1000000) throw new Error("Request too large"); }
    const result = await api(req.url!.slice(1), JSON.parse(content || "{}"));
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(result));
  } catch (error) { res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) })); }
});
server.on("upgrade", (req, socket, head) => {
  if (req.headers["x-workspace-token"] !== token || !(req.url === "/browser" || req.url?.startsWith(`/preview/${encodeURIComponent(issue)}/`))) { socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n"); return; }
  void proxy(req, socket, head).catch(() => socket.destroy());
});
server.listen(7777, "0.0.0.0");
// Source/dependencies and the launch plan survive container recreation. Backend
// restarts simply reconnect to this gateway and its existing processes.
try { plan = JSON.parse(await readFile("/state/preview.json", "utf8")); if (plan) await apps.launch(issue, plan); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Preview recovery:", error); }
import { filesystem, workspaceFile } from "./workspaceFiles.js";
