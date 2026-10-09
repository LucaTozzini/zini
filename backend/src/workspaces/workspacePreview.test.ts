import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { chromium } from "playwright";
import { WorkspaceAppRuntime, availableAppPort, validateAppLaunchPlan, type AppLaunchPlan } from "./workspaceAppRuntime.js";
import { workspacePreview, workspacePreviewUpgrades } from "./workspacePreview.js";

const fixture = `
const http = require('http'), crypto = require('crypto');
const server = http.createServer((req, res) => {
  if (req.url.endsWith('/redirect')) { res.writeHead(302, {location:'/login', 'set-cookie':'app=yes; Domain=localhost; Path=/; HttpOnly'}); res.end(); return; }
  let body=[]; req.on('data', data=>body.push(data)); req.on('end',()=> {
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({url:req.url,method:req.method,body:Buffer.concat(body).toString('hex'),host:req.headers.host}));
  });
});
server.on('upgrade',(req,socket)=>{
  const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: '+accept+'\\r\\n\\r\\n');
  socket.on('error',()=>{});
  socket.once('data',()=>{ const text=Buffer.from(req.url);socket.write(Buffer.concat([Buffer.from([0x81,text.length]),text])); });
});
server.listen(Number(process.argv[2]),'127.0.0.1');
`;

test("preview forwards HTTP bodies, API routes, redirects and WebSockets and disappears on stop", async () => {
  const root = await mkdtemp(join(tmpdir(), "zini-preview-"));
  const runtime = new WorkspaceAppRuntime(async () => root);
  const webPort = await availableAppPort(), apiPort = await availableAppPort();
  const plan: AppLaunchPlan = { setup: [], services: [webPort, apiPort].map((port, index) => ({
    id: index ? "api" : "web", command: `"${process.execPath}" server.cjs ${port}`, cwd: ".", port, readiness: "http", path: "/",
  })), app: { serviceId: "web", path: "/", preservePreviewPath: true }, routes: [{ prefix: "/api", serviceId: "api", stripPrefix: true }] };
  const app = express(); app.use(workspacePreview(runtime)); app.use(express.json());
  const server = createServer(app); workspacePreviewUpgrades(server, runtime);
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let ws: WebSocket | undefined;
  try {
    await writeFile(join(root, "server.cjs"), fixture);
    assert.throws(() => validateAppLaunchPlan({ ...plan, routes: [{ prefix: "/api", serviceId: "missing", stripPrefix: true }] }), /declared HTTP/);
    const result = await runtime.launch("test", plan);
    assert.equal(result.status, "ready");
    assert.equal("previewUrl" in result ? result.previewUrl : null, "/preview/test/");
    const binary = Buffer.from([0, 1, 2, 255]);
    const response = await fetch(`${origin}/preview/test/api/echo?q=1`, { method: "POST", body: binary });
    assert.deepEqual(await response.json(), { url: "/echo?q=1", method: "POST", body: "000102ff", host: `127.0.0.1:${apiPort}` });
    const frontend = await fetch(`${origin}/preview/test/apiculture`);
    assert.equal((await frontend.json() as { url: string }).url, "/preview/test/apiculture"); // Prefix boundary, not /api.
    const redirect = await fetch(`${origin}/preview/test/api/redirect`, { redirect: "manual" });
    assert.equal(redirect.headers.get("location"), "/preview/test/api/login");
    assert.equal(redirect.headers.get("set-cookie"), "app=yes; Path=/preview/test/; HttpOnly");
    const canonical = await fetch(`${origin}/preview/test?q=1`, { redirect: "manual" });
    assert.equal(canonical.headers.get("location"), "/preview/test/?q=1");
    ws = new WebSocket(`${origin.replace("http:", "ws:")}/preview/test/api/socket?q=1`);
    const message = await new Promise<string>((done, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket timeout")), 5000);
      ws!.onopen = () => ws!.send("ping");
      ws!.onmessage = event => { clearTimeout(timer); done(String(event.data)); };
      ws!.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket failed")); };
    });
    assert.equal(message, "/socket?q=1");
    await runtime.stop("test");
    assert.equal((await fetch(`${origin}/preview/test/`)).status, 404);
    assert.equal((await fetch(`${origin}/preview/unknown/`)).status, 404);
  } finally {
    ws?.close(); await runtime.stopAll(); server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a real Vite app loads assets, calls its backend, and hot reloads through the preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "zini-preview-vite-"));
  const runtime = new WorkspaceAppRuntime(async () => root);
  const webPort = await availableAppPort(), apiPort = await availableAppPort();
  const base = "/preview/vite-test/";
  const main = (text: string) => `import './style.css'; fetch(import.meta.env.BASE_URL+'api/hello').then(r=>r.json()).then(data=>document.querySelector('#app').textContent='${text} '+data.url);`;
  const app = express(); app.use(workspacePreview(runtime));
  const server = createServer(app); workspacePreviewUpgrades(server, runtime);
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch();
  try {
    await writeFile(join(root, "server.cjs"), fixture);
    await writeFile(join(root, "index.html"), '<div id="app"></div><script type="module" src="/main.js"></script>');
    await writeFile(join(root, "main.js"), main("Preview"));
    await writeFile(join(root, "style.css"), "body{color:rgb(10,20,30)}");
    const result = await runtime.launch("vite-test", { setup: [], services: [
      { id: "api", command: `"${process.execPath}" server.cjs ${apiPort}`, cwd: ".", port: apiPort, readiness: "http", path: "/" },
      { id: "web", command: `"${process.execPath}" "${resolve("node_modules/vite/bin/vite.js")}" --host 127.0.0.1 --port ${webPort} --strictPort --base ${base}`, cwd: ".", port: webPort, readiness: "http", path: base },
    ], app: { serviceId: "web", path: "/", preservePreviewPath: true }, routes: [{ prefix: "/api", serviceId: "api", stripPrefix: true }] });
    assert.equal(result.status, "ready", JSON.stringify(result));
    const page = await browser.newPage();
    const errors: string[] = [], connections: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("websocket", socket => connections.push(socket.url()));
    await page.goto(`${origin}${base}`);
    await page.getByText("Preview /hello", { exact: true }).waitFor();
    assert.ok(connections.some(url => url.startsWith(origin.replace("http:", "ws:")+base)), "HMR must connect through the proxy");
    await writeFile(join(root, "main.js"), main("Updated"));
    await page.getByText("Updated /hello", { exact: true }).waitFor({ timeout: 15_000 });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await runtime.stopAll(); server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
