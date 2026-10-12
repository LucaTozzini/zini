import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

test("workspace services support seed recovery, app readiness, reuse, restart, isolation and cleanup", {
  skip: process.env.ZINI_DOCKER_TESTS !== "1", timeout: 360000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-services-"));
  process.env.DB_PATH = join(dir, "db.sqlite");
  const { createTestWorkspace } = await import("./testFixtures.js");
  const { provisionWorkspaceServices, workspaceServiceHealth } = await import("./workspaceServices.js");
  const { ensureSandbox, removeSandbox, docker, sandboxName } = await import("./workspaceSandbox.js");
  const { runCommandResult } = await import("../forge/qaProcesses.js");
  const { SetupEvidence, setupTools } = await import("../forge/setupTools.js");
  const { sequelize } = await import("../db.js");
  const { removeWorkspaceMarker } = await import("../repositories/git.js");
  const ids = [`services-${randomUUID()}`, `services-${randomUUID()}`];
  const script = `import pg from 'pg'; import {createClient} from 'redis'; import {createServer} from 'node:http';
const db=new pg.Client({connectionString:process.env.DATABASE_URL}); const redis=createClient({url:process.env.REDIS_URL});
await db.connect(); await redis.connect(); const op=process.argv[2];
if(op==='migrate') await db.query('CREATE TABLE IF NOT EXISTS fixtures(id int primary key)');
if(op==='seed'){await db.query('INSERT INTO fixtures VALUES (1) ON CONFLICT DO NOTHING'); await redis.set('fixture','seeded');}
if(op==='verify'){if((await db.query('SELECT * FROM fixtures')).rowCount!==1 || await redis.get('fixture')!=='seeded') throw Error('fixture missing'); console.log('fixtures verified');}
if(op==='serve'){await db.query('SELECT * FROM fixtures'); if(await redis.get('fixture')!=='seeded')throw Error('Redis fixture missing');createServer((_q,r)=>r.end('ready')).listen(4318);}
else {await db.end(); await redis.quit();}
`;
  try {
    await createTestWorkspace(ids[0]!, { "package.json": JSON.stringify({ type: "module", dependencies: { pg: "^8.16.3", redis: "^4.7.0" } }), "services.mjs": script });
    await provisionWorkspaceServices(ids[0]!, [{ kind: "postgres", bindings: { DB_HOST: "host", DB_NAME: "database" } }, { kind: "redis" }]);
    const evidence = new SetupEvidence(null, "fixture"); const tools = setupTools(ids[0]!, evidence);
    const run = tools.find(tool => tool.name === "run_setup")!;
    const entry = (command: string) => ({ id: command, kind: "setup" as const, cwd: ".", command, purpose: "Prepare isolated fixtures", sources: ["services.mjs"] });
    await run.invoke({ entry: entry("npm install --ignore-scripts") });
    const failure = await run.invoke({ entry: entry("node services.mjs seed") });
    assert.match(JSON.stringify(failure), /blocked/);
    await run.invoke({ entry: entry("node services.mjs migrate") });
    await run.invoke({ entry: entry("node services.mjs seed") });
    assert.match(JSON.stringify(await run.invoke({ entry: entry("node services.mjs verify") })), /fixtures verified/);
    const probe = await tools.find(tool => tool.name === "check_app")!.invoke({ command: "node services.mjs serve", url: "http://localhost:4318/" });
    assert.match(JSON.stringify(probe), /passed/);
    const { startProcess, stopProcess } = await import("../forge/qaProcesses.js");
    const occupied = await startProcess(ids[0]!, "node services.mjs serve");
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const falseProbe = await tools.find(tool => tool.name === "check_app")!.invoke({ command: "node services.mjs serve", url: "http://localhost:4318/" });
      assert.match(JSON.stringify(falseProbe), /blocked/);
    } finally { await stopProcess(ids[0]!, occupied); }
    // Reuse services and restore their environment after a gateway restart.
    await provisionWorkspaceServices(ids[0]!, [{ kind: "postgres" }, { kind: "redis" }]);
    await docker(["restart", sandboxName(ids[0]!)]); await ensureSandbox(ids[0]!);
    assert.equal((await runCommandResult(ids[0]!, "node services.mjs verify")).exitCode, 0);
    await createTestWorkspace(ids[1]!, { "file.txt": "independent workspace" });
    await provisionWorkspaceServices(ids[1]!, [{ kind: "postgres" }, { kind: "redis" }]);
    const other = JSON.parse(await docker(["inspect", `${sandboxName(ids[1]!)}-postgres`]))[0];
    assert.equal(Object.keys(other.HostConfig.PortBindings ?? {}).length, 0);
    assert.equal((await docker(["exec", `${sandboxName(ids[1]!)}-postgres`, "psql", "-U", "zini", "-d", "zini_test", "-tAc", "SELECT count(*) FROM information_schema.tables WHERE table_name='fixtures'"])).trim(), "0");
    assert.equal((await workspaceServiceHealth(ids[0]!)).length, 2);
  } finally {
    for (const id of ids) { await removeSandbox(id); await removeWorkspaceMarker(id); }
    await sequelize.close(); await rm(dir, { recursive: true, force: true });
  }
  for (const id of ids) for (const kind of ["postgres", "redis"]) {
    await assert.rejects(docker(["inspect", `${sandboxName(id)}-${kind}`]));
    await assert.rejects(docker(["volume", "inspect", `${sandboxName(id)}-${kind}-data`]));
  }
});
