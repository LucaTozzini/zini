import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";

test("Docker workspace isolates commands, recovers previews and keeps QA cleanup independent", { skip: process.env.ZINI_DOCKER_TESTS !== "1", timeout: 240000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-sandbox-test-"));
  process.env.DB_PATH = join(dir, "db.sqlite");
  const { git, workspacePath } = await import("../repositories/git.js");
  const { ensureSandbox, removeSandbox, workspaceRequest, docker } = await import("./workspaceSandbox.js");
  const { runCommandResult, startProcess, stopAllProcesses } = await import("../forge/qaProcesses.js");
  const { WorkspaceAppRuntime, availableAppPort } = await import("./workspaceAppRuntime.js");
  const { getPage, closeBrowser } = await import("../browser/agentBrowser.js");
  const { sequelize } = await import("../db.js");
  const issue = randomUUID(), other = randomUUID(), root = workspacePath(issue);
  try {
    const { createTestWorkspace } = await import("./testFixtures.js");
    for (const id of [issue, other]) await createTestWorkspace(id, { "README.md": "sandbox\n" });
    const { startRun } = await import("../agents/runs.js");
    assert.equal(await startRun(`forge:${issue}`, async () => {
      assert.equal(await workspaceRequest(issue, "file", { operation: "readText", path: "README.md" }), "sandbox\n");
      return (async function* () { yield {}; })();
    }, () => {}), true);
    const sandbox = await ensureSandbox(issue);
    const { containerFilesystem } = await import("./containerFilesystem.js");
    const readonly = containerFilesystem(issue);
    assert.match((await readonly.write("forbidden", "no")).error!, /read-only/);
    await assert.rejects(workspaceRequest(issue, "file", { operation: "readText", path: "../outside" }), /traversal/);
    await assert.rejects(workspaceRequest(issue, "file", { operation: "fingerprint", path: ".git/config" }), /\.git/);
    await runCommandResult(issue, "ln -s /state/home outside-link; ln -s .git git-link");
    await assert.rejects(workspaceRequest(issue, "file", { operation: "fingerprint", path: "outside-link" }), /outside/);
    await assert.rejects(workspaceRequest(issue, "file", { operation: "readText", path: "git-link/config" }), /\.git/);
    await runCommandResult(issue, "rm outside-link git-link");
    assert.deepEqual(await ensureSandbox(issue), sandbox);
    const result = await runCommandResult(issue, "id -u; pwd; node --version; git diff; printenv OPENROUTER_API_KEY");
    assert.match(result.output, /1000\n\/workspace/); assert.doesNotMatch(result.output, /OPENROUTER/);
    const dependencies = await runCommandResult(issue, "npm view bcryptjs version");
    assert.equal(dependencies.exitCode, 0, dependencies.output);
    assert.equal((await runCommandResult(issue, "git diff --exit-code")).exitCode, 0);
    const unavailableHost = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = "tcp://127.0.0.1:1";
    try { await assert.rejects(runCommandResult(issue, "touch host-fallback-marker"), /not run on the host/); }
    finally { if (unavailableHost === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = unavailableHost; }
    await assert.rejects(runCommandResult(issue, "touch should-not-exist", "../"), /outside/);
    const timed = await runCommandResult(issue, "sleep 20", ".", 1); assert.equal(timed.timedOut, true);
    const abort = new AbortController(); const running = runCommandResult(issue, "sleep 20", ".", 30, abort.signal);
    setTimeout(() => abort.abort(), 500); await assert.rejects(running, /abort/i);
    const isolation = await runCommandResult(issue, "curl --max-time 2 http://host.docker.internal:3000 2>&1; grep CapEff /proc/self/status");
    assert.match(isolation.output, /CapEff:\s+0+/);
    assert.notEqual((await runCommandResult(issue, "curl --max-time 2 http://host.docker.internal:3000")).exitCode, 0);
    const second = await ensureSandbox(other); assert.notEqual(second.port, sandbox.port);
    await runCommandResult(issue, "printf persistent > saved"); assert.equal(await workspaceRequest(issue,"file", { operation: "readText", path: "saved" }), "persistent");
    await assert.rejects(access(join(root, "saved")), { code: "ENOENT" });
    await git(["-C", root, "add", "saved"]); await git(["-C", root, "commit", "-qm", "volume-only change"]);
    assert.match(await git(["-C", root, "log", "-1", "--format=%s"]), /volume-only change/);
    await runCommandResult(issue, "git config filter.attack.clean 'echo unsafe'");
    await assert.rejects(git(["-C", root, "status", "--porcelain"]), /Unsafe workspace Git configuration/);
    await runCommandResult(issue, "git config --remove-section filter.attack");
    await workspaceRequest(issue, "filesystem", { method: "write", args: ["app.cjs", `const http=require('http'),crypto=require('crypto');const s=http.createServer((req,res)=>res.end('workspace '+req.url));s.on('upgrade',(req,socket)=>{const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: '+accept+'\\r\\n\\r\\n');socket.on('error',()=>{});socket.once('data',()=>{const text=Buffer.from(req.url);socket.write(Buffer.concat([Buffer.from([0x81,text.length]),text]));});});s.listen(Number(process.argv[2]),'127.0.0.1');`] });
    const runtime = new WorkspaceAppRuntime(), port = await availableAppPort(issue);
    const plan = { setup: [], services: [{ id: "web", command: `node app.cjs ${port}`, cwd: ".", port, readiness: "http" as const, path: "/" }], app: { serviceId: "web", path: "/" } };
    assert.equal((await runtime.launch(issue, plan)).status, "ready");
    await startProcess(issue, "sleep 60"); await stopAllProcesses(issue);
    assert.match(await workspaceRequest<string>(issue, "http", { url: `http://127.0.0.1:${port}/`, method: "GET" }), /workspace/);
    const recovered = new WorkspaceAppRuntime(); assert.equal((await recovered.refresh(issue)).status, "ready");
    const target = recovered.previewTarget(issue, "/hello")!;
    assert.equal(await (await fetch(`http://127.0.0.1:${target.port}${target.transportPath}`, { headers: { "x-workspace-token": target.token } })).text(), "workspace /hello");
    assert.equal((await fetch(`http://127.0.0.1:${target.port}/health`, { method: "POST" })).status, 401);
    // The host proxy crosses the gateway for both HTTP and WebSocket upgrades.
    const { workspacePreview, workspacePreviewUpgrades } = await import("./workspacePreview.js");
    const proxyApp = express(); proxyApp.use(workspacePreview(recovered)); const proxy = createServer(proxyApp); workspacePreviewUpgrades(proxy, recovered);
    await new Promise<void>(done => proxy.listen(0,"127.0.0.1",done));
    const proxyPort = (proxy.address() as { port: number }).port;
    const sockets = new Set<import("node:net").Socket>(); proxy.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    let ws: WebSocket | undefined;
    try {
      assert.equal(await (await fetch(`http://127.0.0.1:${proxyPort}/preview/${issue}/http?q=1`)).text(), "workspace /http?q=1");
      ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/preview/${issue}/socket?q=1`);
      const message = await new Promise<string>((done,reject) => {
        const timer = setTimeout(() => reject(new Error("Gateway WebSocket timed out")),5000);
        ws!.onopen = () => ws!.send("ping"); ws!.onmessage = event => { clearTimeout(timer); done(String(event.data)); };
        ws!.onerror = () => { clearTimeout(timer); reject(new Error("Gateway WebSocket failed")); };
      });
      assert.equal(message, "/socket?q=1");
    } finally { ws?.close(); for (const socket of sockets) socket.destroy(); proxy.closeAllConnections(); await new Promise<void>(done => proxy.close(() => done())); }
    const { page } = await getPage(issue); await page.goto(`http://127.0.0.1:${port}/browser`);
    assert.equal(await page.textContent("body"), "workspace /browser"); await closeBrowser(issue);
    // Replacing the container keeps the workspace files and preview plan in volumes.
    await docker(["rm", "-f", sandbox.name]); await ensureSandbox(issue);
    for (let attempt = 0; attempt < 50 && (await recovered.refresh(issue)).status !== "ready"; attempt++) await new Promise(resolve => setTimeout(resolve,200));
    assert.equal(recovered.status(issue).status, "ready"); assert.equal(await workspaceRequest(issue,"file", { operation: "readText", path: "saved" }), "persistent");
    await recovered.stop(issue);
    // Exercise the trusted eval check adapter without spending model tokens.
    await workspaceRequest(issue, "filesystem", { method: "write", args: ["package.json", JSON.stringify({ scripts: { dev: "node fixture.cjs" } })] });
    await workspaceRequest(issue, "filesystem", { method: "write", args: ["fixture.cjs", "const fs=require('fs');require('http').createServer((req,res)=>{const p=process.env.DATA_FILE; if(req.method==='POST')fs.writeFileSync(p,'changed');res.end(fs.existsSync(p)?fs.readFileSync(p):'empty')}).listen(Number(process.env.PORT),'127.0.0.1')"] });
    const dataFile = join(dir, "fixture.json"); await writeFile(dataFile,"initial");
    const { startApp } = await import(new URL("../../../evals/harness/app.ts", import.meta.url).href);
    const first = await startApp(issue, { dataFile });
    assert.equal(await (await fetch(first.url)).text(), "initial");
    await fetch(first.url, { method: "POST" }); await first.stop();
    const secondApp = await startApp(issue, { dataFile });
    assert.equal(await (await fetch(secondApp.url)).text(), "changed");
    const { page: checkPage } = await getPage(issue); await checkPage.goto(secondApp.browserUrl);
    assert.equal(await checkPage.textContent("body"), "changed");
    await closeBrowser(issue); await secondApp.stop();
    // A parent eval process has a different database path. It must supply the
    // run's storage identity, and a mistaken path must leave the workspace intact.
    await assert.rejects(removeSandbox(issue, join(dir, "wrong.sqlite")), /different data directory/);
    assert.equal(await workspaceRequest(issue, "file", { operation: "readText", path: "saved" }), "persistent");
    const cleanupModule = new URL("./workspaceSandbox.ts", import.meta.url).href;
    await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `const { removeSandbox } = await import(${JSON.stringify(cleanupModule)}); await removeSandbox(${JSON.stringify(issue)}, ${JSON.stringify(join(dir, "db.sqlite"))});`],
      { env: { ...process.env, DB_PATH: join(dir, "parent.sqlite") }, windowsHide: true, timeout: 30000 });
    await assert.rejects(docker(["volume", "inspect", `${sandbox.name}-files`]), /no such volume/i);
  } finally {
    await closeBrowser(issue); await removeSandbox(issue); await removeSandbox(other); await sequelize.close();
    await rm(dir, { recursive: true, force: true });
  }
});
