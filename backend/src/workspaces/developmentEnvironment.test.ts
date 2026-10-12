import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

test("workspace credentials reach setup and previews, rotate, and respect service precedence", {
  skip: process.env.ZINI_DOCKER_TESTS !== "1", timeout: 240000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-dev-runtime-"));
  process.env.DB_PATH = join(dir, "db.sqlite");
  const { createTestWorkspace } = await import("./testFixtures.js");
  const { initDb, sequelize } = await import("../db.js");
  const { saveSettings } = await import("../core/settings.js");
  const { saveDevelopmentEnvironment } = await import("../core/developmentEnvironment.js");
  const { ensureSandbox, removeSandbox, docker, sandboxName } = await import("./workspaceSandbox.js");
  const { removeWorkspaceMarker } = await import("../repositories/git.js");
  const { runCommandResult } = await import("../forge/qaProcesses.js");
  const { SetupEvidence, setupTools } = await import("../forge/setupTools.js");
  const { provisionWorkspaceServices, configureWorkspaceEnvironment } = await import("./workspaceServices.js");
  const { WorkspaceAppRuntime } = await import("./workspaceAppRuntime.js");
  await initDb(); await saveSettings({ githubRepo: "fixture/dev" });
  const id = `dev-env-${randomUUID()}`; const runtime = new WorkspaceAppRuntime();
  const token = "synthetic-secret-first-123";
  const script = `const token=process.env.DEV_TOKEN;if(!token)throw Error('Missing DEV_TOKEN');require('http').createServer((_q,r)=>r.end('ready')).listen(4321);`;
  try {
    await createTestWorkspace(id, { "app.cjs": script });
    await saveDevelopmentEnvironment("fixture/dev", [{ name: "DEV_TOKEN", value: token }, { name: "APP_LABEL", value: "public-label" }]);
    const evidence = new SetupEvidence(null, "fixture");
    const entry = { id: "credentials", kind: "setup" as const, command: "node -e 'if(!process.env.DEV_TOKEN)process.exit(1);console.log(process.env.APP_LABEL)'", cwd: ".", purpose: "Check injected credentials", sources: ["app.cjs"] };
    const output = await setupTools(id, evidence).find(tool => tool.name === "run_setup")!.invoke({ entry });
    assert.match(JSON.stringify(output), /passed/); assert.match(JSON.stringify(output), /public-label/); assert.ok(!JSON.stringify(evidence.results).includes(token));
    await assert.rejects(configureWorkspaceEnvironment(id, { DEV_TOKEN: "agent-override" }), /Settings/);
    const plan = { setup: [], services: [{ id: "web", command: "node app.cjs", cwd: ".", port: 4321, readiness: "http" as const, path: "/" }], app: { serviceId: "web", path: "/" } };
    const preview = await runtime.launch(id, plan); assert.equal(preview.status, "ready");
    assert.ok(!JSON.stringify(preview).includes(token));
    await runtime.stop(id);
    await saveDevelopmentEnvironment("fixture/dev", [{ name: "DEV_TOKEN", value: "synthetic-secret-rotated-456" }]);
    const rotated = await runCommandResult(id, "node -e 'if(process.env.DEV_TOKEN.endsWith(\"456\"))console.log(\"configured\");else process.exit(1)'" );
    assert.equal(rotated.exitCode, 0); assert.match(rotated.output, /configured/);
    await docker(["restart", sandboxName(id)]); await ensureSandbox(id);
    assert.match((await runCommandResult(id, "node -e 'if(!process.env.DEV_TOKEN.endsWith(\"456\"))process.exit(1);console.log(\"configured\")'" )).output, /configured/);
    await saveDevelopmentEnvironment("fixture/dev", [{ name: "DATABASE_URL", value: "postgresql://external.invalid/production" }]);
    await provisionWorkspaceServices(id, [{ kind: "postgres", bindings: { TEST_DB_PASSWORD: "password" } }]);
    const generated = await runCommandResult(id, "node -e 'if(new URL(process.env.DATABASE_URL).hostname!==\"postgres\"||process.env.TEST_DB_PASSWORD!==process.env.PGPASSWORD)process.exit(1);console.log(\"configured\")'" );
    assert.equal(generated.exitCode, 0); assert.ok(!generated.output.includes("postgresql://")); assert.match(generated.output, /configured/);
    await saveSettings({ githubRepo: "fixture/other" });
    assert.equal((await runCommandResult(id, "test -z \"$DEV_TOKEN\" && test -z \"$APP_LABEL\"" )).exitCode, 0);
    await saveSettings({ githubRepo: "fixture/dev" });
    await saveDevelopmentEnvironment("fixture/dev", [{ name: "DEV_TOKEN", remove: true }, { name: "APP_LABEL", remove: true }, { name: "DATABASE_URL", remove: true }]);
    assert.equal((await runCommandResult(id, "test -z \"$DEV_TOKEN\" && test -z \"$APP_LABEL\"" )).exitCode, 0);
  } finally {
    await runtime.stopAll(); await removeSandbox(id); await removeWorkspaceMarker(id).catch(() => {});
    await sequelize.close(); await rm(dir, { recursive: true, force: true });
  }
});
