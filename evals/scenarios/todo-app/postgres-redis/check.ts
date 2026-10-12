import type { Check } from "../../../harness/types.js";

const check: Check = async ({ runCommand, startApp }) => {
  // No mocked service clients: hidden checks query the real provisioned services.
  const reset = await runCommand(`node --input-type=module -e 'import pg from "pg"; import {createClient} from "redis"; const db=new pg.Client({connectionString:process.env.DATABASE_URL});const cache=createClient({url:process.env.REDIS_URL});await db.connect();await cache.connect();await db.query("DELETE FROM service_todos");await db.query("INSERT INTO service_todos(id,title,done) VALUES ($1,$2,false),($3,$4,false),($5,$6,true)",["seed-a","A","seed-b","B","seed-c","C"]);await cache.del("todo-service:stats");await cache.set("todo-service:seeded","ready");await db.end();await cache.quit();'`);
  if (reset.exitCode !== 0) return { passed: false, details: `Real SQL/Redis fixture initialization failed: ${reset.output}` };
  let app = await startApp();
  try {
    const health = await fetch(`${app.url}/api/service-health`).then(response => response.json()) as { postgres: string; redis: string };
    if (health.postgres !== "ready" || health.redis !== "ready") throw new Error("Both real services must be ready");
    const stats = async () => {
      const response = await fetch(`${app.url}/api/shared-todos/stats`);
      return { body: await response.json() as { total: number; remaining: number }, source: response.headers.get("x-stats-source") };
    };
    let result = await stats();
    if (result.body.total !== 3 || result.body.remaining !== 2 || result.source !== "database") throw new Error(`Incorrect SQL statistics: ${JSON.stringify(result)}`);
    result = await stats();
    if (result.source !== "cache" || result.body.remaining !== 2) throw new Error("Second statistics request must use Redis");
    const changed = await fetch(`${app.url}/api/shared-todos/seed-a`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: true }) });
    if (!changed.ok) throw new Error("Todo mutation failed");
    result = await stats();
    if (result.body.remaining !== 1 || result.source !== "database") throw new Error("Mutation must invalidate cache and update remaining count");
    const actual = await runCommand(`node --input-type=module -e 'import assert from "node:assert/strict";import pg from "pg";import {createClient} from "redis";const db=new pg.Client({connectionString:process.env.DATABASE_URL});const cache=createClient({url:process.env.REDIS_URL});await db.connect();await cache.connect();assert.equal((await db.query("SELECT count(*)::int AS n FROM service_todos WHERE NOT done")).rows[0].n,1);assert.equal(JSON.parse(await cache.get("todo-service:stats")).remaining,1);await db.end();await cache.quit();'`);
    if (actual.exitCode !== 0) throw new Error(`Actual service state disagrees with API: ${actual.output}`);
    await app.stop(); app = await startApp();
    result = await stats();
    if (result.body.total !== 3 || result.body.remaining !== 1) throw new Error("Statistics did not survive application restart");
    const original = await fetch(`${app.url}/api/todos`);
    if (!original.ok) throw new Error("Original todo API regressed");
    return { passed: true, details: "Real PostgreSQL counts/persistence, Redis cache/invalidation, backend readiness and original API verified" };
  } finally { await app.stop(); }
};
export default check;
