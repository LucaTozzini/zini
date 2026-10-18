import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { availableAppPort, WorkspaceAppRuntime, type AppLaunchPlan } from "./localAppRuntime.js";

test("user sessions run setup before HTTP readiness, remain alive, and stop independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "zini-launcher-"));
  const runtime = new WorkspaceAppRuntime(async () => root);
  const firstPort = await availableAppPort();
  const secondPort = await availableAppPort();
  await writeFile(join(root, "setup.cjs"), "require('fs').writeFileSync('prepared', 'yes');");
  await writeFile(
    join(root, "app.cjs"),
    `
    if (!require('fs').existsSync('prepared')) process.exit(1);
    require('http').createServer((req, res) => res.end('workspace app')).listen(Number(process.argv[2]), '127.0.0.1');
  `,
  );
  const plan = (port: number): AppLaunchPlan => ({
    setup: [{ command: `"${process.execPath}" setup.cjs`, cwd: "." }],
    services: [{ id: "web", command: `"${process.execPath}" app.cjs ${port}`, cwd: ".", port, readiness: "http", path: "/" }],
    app: { serviceId: "web", path: "/" },
  });
  try {
    assert.equal((await runtime.launch("first", plan(firstPort))).status, "ready");
    assert.equal(await readFile(join(root, "prepared"), "utf8"), "yes");
    assert.equal((await runtime.launch("first", plan(firstPort))).status, "ready"); // Reuse, no duplicate server.
    assert.equal((await runtime.launch("second", plan(secondPort))).status, "ready");
    assert.equal((await runtime.stop("first")).status, "stopped");
    assert.equal(runtime.status("first").status, "stopped");
    const response = await fetch(`http://127.0.0.1:${secondPort}/`);
    assert.equal(await response.text(), "workspace app");
  } finally {
    await runtime.stopAll();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("setup failure prevents startup and occupied ports are never reported as a successful launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "zini-launcher-fail-"));
  const runtime = new WorkspaceAppRuntime(async () => root);
  const port = await availableAppPort();
  await writeFile(join(root, "fail.cjs"), "console.error('missing configuration'); process.exit(1);");
  await writeFile(join(root, "app.cjs"), `require('http').createServer((req,res)=>res.end('ok')).listen(${port},'127.0.0.1');`);
  const plan: AppLaunchPlan = {
    setup: [],
    services: [{ id: "web", command: `"${process.execPath}" app.cjs`, cwd: ".", port, readiness: "http", path: "/" }],
    app: { serviceId: "web", path: "/" },
  };
  try {
    const failed = await runtime.launch("bad", { ...plan, setup: [{ command: `"${process.execPath}" fail.cjs`, cwd: "." }] });
    assert.equal(failed.status, "failed");
    assert.match("output" in failed ? failed.output : "", /missing configuration/);
    assert.equal((await runtime.launch("owner", plan)).status, "ready");
    const conflicting = await runtime.launch("other", plan);
    assert.equal(conflicting.status, "failed");
    assert.match("error" in conflicting ? (conflicting.error ?? "") : "", /already in use/);
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(await response.text(), "ok");
  } finally {
    await runtime.stopAll();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
