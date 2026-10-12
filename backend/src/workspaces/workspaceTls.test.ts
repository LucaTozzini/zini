import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";

test("TLS setup reuses isolated certificates and supports HTTPS readiness, QA, previews and WebSockets", {
  skip: process.env.ZINI_DOCKER_TESTS !== "1", timeout: 180000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-tls-")); process.env.DB_PATH = join(dir, "db.sqlite");
  const { createTestWorkspace } = await import("./testFixtures.js");
  const { ensureSandbox, workspaceRequest, removeSandbox, docker, sandboxName } = await import("./workspaceSandbox.js");
  const { SetupEvidence, setupTools } = await import("../forge/setupTools.js");
  const { startProcess, stopProcess, runCommandResult } = await import("../forge/qaProcesses.js");
  const { getPage, closeBrowser } = await import("../browser/agentBrowser.js");
  const { WorkspaceAppRuntime } = await import("./workspaceAppRuntime.js");
  const { workspacePreview, workspacePreviewUpgrades } = await import("./workspacePreview.js");
  const { removeWorkspaceMarker } = await import("../repositories/git.js");
  const { sequelize } = await import("../db.js");
  const { saveSettings } = await import("../core/settings.js");
  const { saveDevelopmentEnvironment } = await import("../core/developmentEnvironment.js");
  const ids = [`tls-${randomUUID()}`, `tls-${randomUUID()}`]; const id = ids[0]!;
  const runtime = new WorkspaceAppRuntime(); const previewRuntime = new WorkspaceAppRuntime();
  const app = express(); app.use(workspacePreview(previewRuntime));
  const server = createServer(app); workspacePreviewUpgrades(server, previewRuntime);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const tlsApp = `const fs=require('fs'),crypto=require('crypto');
const server=require('https').createServer({key:fs.readFileSync(process.env.REPO_KEY),cert:fs.readFileSync(process.env.REPO_CERT)},(q,r)=>{
if(q.url==='/'){r.end('<h1>TLS works</h1>');return;}let body='';q.on('data',c=>body+=c);q.on('end',()=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({url:q.url,body,origin:q.headers.origin}));});});
server.on('upgrade',(q,s)=>{s.on('error',()=>{});const accept=crypto.createHash('sha1').update(q.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');s.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: '+accept+'\\r\\n\\r\\n');s.once('data',()=>{const b=Buffer.from(q.url);s.write(Buffer.concat([Buffer.from([0x81,b.length]),b]));});});server.listen(4443,'127.0.0.1');`;
  let ws: WebSocket | undefined;
  try {
    await createTestWorkspace(id, { "tls.cjs": tlsApp, "http.cjs": "require('http').createServer((q,r)=>r.end('HTTP works')).listen(4444,'127.0.0.1');" });
    await saveSettings({ githubRepo: "fixture/tls" });
    await saveDevelopmentEnvironment("fixture/tls", [{ name: "TLS_KEY", value: "invalid-host-path" }]);
    const tools = setupTools(id, new SetupEvidence(null, "fixture"));
    const generate = tools.find(tool => tool.name === "generate_tls_certificates")!;
    const bindings = { REPO_KEY: "key", REPO_CERT: "cert" } as const;
    const first = JSON.parse(JSON.stringify(await generate.invoke({ bindings })));
    assert.equal(first.reused, false); assert.equal(first.key, "/state/dev-tls/key.pem");
    assert.ok(!JSON.stringify(first).includes("PRIVATE KEY"));
    assert.equal(JSON.parse(JSON.stringify(await generate.invoke({ bindings }))).reused, true);
    assert.equal((await runCommandResult(id, 'test "$TLS_KEY" = "$REPO_KEY" && stat -c %a "$TLS_KEY"')).output.trim(), "600");
    const readiness = await tools.find(tool => tool.name === "check_app")!.invoke({ command: "node tls.cjs", url: "https://127.0.0.1:4443/" });
    assert.match(JSON.stringify(readiness), /passed/);
    const process = await startProcess(id, "node tls.cjs");
    try {
      const { page } = await getPage(id); await page.goto("https://127.0.0.1:4443/");
      assert.equal(await page.getByRole("heading").innerText(), "TLS works");
      assert.match(await workspaceRequest<string>(id, "http", { method: "GET", url: "https://localhost:4443/" }), /^200/);
      assert.equal((await runCommandResult(id, "node -e 'fetch(\"https://127.0.0.1:4443/\").then(r=>{if(r.status!==200)process.exit(1)})'" )).exitCode, 0);
    } finally { await closeBrowser(id); await stopProcess(id, process); }
    const plan = { setup: [], services: [
      { id: "web", command: "node http.cjs", cwd: ".", port: 4444, readiness: "http" as const, path: "/" },
      { id: "api", command: "node tls.cjs", cwd: ".", port: 4443, readiness: "https" as const, path: "/" },
    ], app: { serviceId: "web", path: "/" }, routes: [{ prefix: "/api", serviceId: "api", stripPrefix: true }] };
    assert.equal((await runtime.launch(id, plan)).status, "ready");
    assert.equal(previewRuntime.status(id).status, "stopped", "A fresh backend has no preview cache");
    const result = await fetch(`${origin}/preview/${id}/api/echo?q=1`, { method: "POST", body: "payload", headers: { origin } });
    assert.deepEqual(await result.json(), { url: "/echo?q=1", body: "payload", origin: "https://127.0.0.1:4443" });
    assert.equal(previewRuntime.status(id).status, "ready", "The preview request recovers routing on demand");
    ws = new WebSocket(`${origin.replace("http:", "ws:")}/preview/${id}/api/socket`);
    assert.equal(await new Promise<string>((resolve, reject) => { const timer = setTimeout(() => reject(Error("WebSocket timeout")), 5000); ws!.onopen = () => ws!.send("hello"); ws!.onmessage = event => { clearTimeout(timer); resolve(String(event.data)); }; ws!.onerror = reject; }), "/socket");
    ws.close();
    await runtime.stop(id);
    assert.equal((await runtime.launch(id, { ...plan, app: { serviceId: "api", path: "/" }, routes: [] })).status, "ready");
    assert.equal(await (await fetch(`${origin}/preview/${id}/`)).text(), "<h1>TLS works</h1>");
    await docker(["restart", sandboxName(id)]); await ensureSandbox(id);
    for (let n = 0; (await fetch(`${origin}/preview/${id}/`)).status !== 200 && n < 30; n++) await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await (await fetch(`${origin}/preview/${id}/`)).text(), "<h1>TLS works</h1>");
    await createTestWorkspace(ids[1]!, {});
    await setupTools(ids[1]!, new SetupEvidence(null, "fixture")).find(tool => tool.name === "generate_tls_certificates")!.invoke({});
    const fingerprint = (workspace: string) => runCommandResult(workspace, "openssl x509 -in /state/dev-tls/cert.pem -noout -fingerprint -sha256");
    assert.notEqual((await fingerprint(id)).output, (await fingerprint(ids[1]!)).output);
  } finally {
    ws?.close(); await runtime.stopAll(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    for (const workspace of ids) { await closeBrowser(workspace); await removeSandbox(workspace); await removeWorkspaceMarker(workspace).catch(() => {}); }
    await sequelize.close(); await rm(dir, { recursive: true, force: true });
  }
});
