import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

test(
  "TLS setup reuses isolated certificates and supports HTTPS readiness, QA and app launches",
  {
    skip: process.env.ZINI_DOCKER_TESTS !== "1",
    timeout: 180000,
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "zini-tls-"));
    process.env.DB_PATH = join(dir, "db.sqlite");
    const { createTestWorkspace, probeApp } = await import("./testFixtures.js");
    const { ensureSandbox, workspaceRequest, removeSandbox, docker, sandboxName } = await import("./workspaceSandbox.js");
    const { serviceTools } = await import("../forge/serviceTools.js");
    const { startProcess, stopProcess, runCommandResult } = await import("../forge/qaProcesses.js");
    const { getPage, closeBrowser } = await import("../browser/agentBrowser.js");
    const { WorkspaceAppRuntime } = await import("./workspaceAppRuntime.js");
    const { removeWorkspaceMarker } = await import("../repositories/git.js");
    const { sequelize } = await import("../db.js");
    const { saveSettings } = await import("../core/settings.js");
    const { saveDevelopmentEnvironment } = await import("../core/developmentEnvironment.js");
    const ids = [`tls-${randomUUID()}`, `tls-${randomUUID()}`];
    const id = ids[0]!;
    const runtime = new WorkspaceAppRuntime();
    // The app's root page through the gateway's /app pass-through, as the eval harness reads it.
    const appPage = async () => {
      const sandbox = await ensureSandbox(id);
      const response = await fetch(`http://127.0.0.1:${sandbox.port}/app/`, { headers: { "x-workspace-token": sandbox.token } });
      return response.ok ? response.text() : null;
    };
    const tlsApp = `const fs=require('fs'),crypto=require('crypto');
const server=require('https').createServer({key:fs.readFileSync(process.env.REPO_KEY),cert:fs.readFileSync(process.env.REPO_CERT)},(q,r)=>{
if(q.url==='/'){r.end('<h1>TLS works</h1>');return;}let body='';q.on('data',c=>body+=c);q.on('end',()=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({url:q.url,body,origin:q.headers.origin}));});});
server.listen(4443,'127.0.0.1');`;
    try {
      await createTestWorkspace(id, {
        "tls.cjs": tlsApp,
        "http.cjs": "require('http').createServer((q,r)=>r.end('HTTP works')).listen(4444,'127.0.0.1');",
      });
      await saveSettings({ githubRepo: "fixture/tls" });
      await saveDevelopmentEnvironment("fixture/tls", [{ name: "TLS_KEY", value: "invalid-host-path" }]);
      const tools = serviceTools(id);
      const generate = tools.find((tool) => tool.name === "generate_tls_certificates")!;
      const bindings = { REPO_KEY: "key", REPO_CERT: "cert" } as const;
      const first = JSON.parse(JSON.stringify(await generate.invoke({ bindings })));
      assert.equal(first.reused, false);
      assert.equal(first.key, "/state/dev-tls/key.pem");
      assert.ok(!JSON.stringify(first).includes("PRIVATE KEY"));
      assert.equal(JSON.parse(JSON.stringify(await generate.invoke({ bindings }))).reused, true);
      assert.equal((await runCommandResult(id, 'test "$TLS_KEY" = "$REPO_KEY" && stat -c %a "$TLS_KEY"')).output.trim(), "600");
      const readiness = await probeApp(id, "node tls.cjs", "https://127.0.0.1:4443/");
      assert.match(JSON.stringify(readiness), /passed/);
      const process = await startProcess(id, "node tls.cjs");
      try {
        const { page } = await getPage(id);
        await page.goto("https://127.0.0.1:4443/");
        assert.equal(await page.getByRole("heading").innerText(), "TLS works");
        assert.match(await workspaceRequest<string>(id, "http", { method: "GET", url: "https://localhost:4443/" }), /^200/);
        assert.equal(
          (
            await runCommandResult(
              id,
              "node -e 'fetch(\"https://127.0.0.1:4443/\").then(r=>{if(r.status!==200)process.exit(1)})'",
            )
          ).exitCode,
          0,
        );
      } finally {
        await closeBrowser(id);
        await stopProcess(id, process);
      }
      const plan = {
        setup: [],
        services: [
          { id: "web", command: "node http.cjs", cwd: ".", port: 4444, readiness: "http" as const, path: "/" },
          { id: "api", command: "node tls.cjs", cwd: ".", port: 4443, readiness: "https" as const, path: "/" },
        ],
        app: { serviceId: "api", path: "/" },
      };
      const launched = await runtime.launch(id, plan);
      assert.equal(launched.status, "ready");
      assert.equal(launched.url, "https://localhost:4443/");
      assert.equal(await appPage(), "<h1>TLS works</h1>");
      // A restarted container relaunches its saved plan.
      await docker(["restart", sandboxName(id)]);
      await ensureSandbox(id);
      for (let n = 0; (await appPage().catch(() => null)) === null && n < 30; n++)
        await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(await appPage(), "<h1>TLS works</h1>");
      await createTestWorkspace(ids[1]!, {});
      await serviceTools(ids[1]!)
        .find((tool) => tool.name === "generate_tls_certificates")!
        .invoke({});
      const fingerprint = (workspace: string) =>
        runCommandResult(workspace, "openssl x509 -in /state/dev-tls/cert.pem -noout -fingerprint -sha256");
      assert.notEqual((await fingerprint(id)).output, (await fingerprint(ids[1]!)).output);
    } finally {
      await runtime.stopAll();
      for (const workspace of ids) {
        await closeBrowser(workspace);
        await removeSandbox(workspace);
        await removeWorkspaceMarker(workspace).catch(() => {});
      }
      await sequelize.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
