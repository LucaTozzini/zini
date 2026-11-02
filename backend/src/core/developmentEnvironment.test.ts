import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

test("development settings import, conceal values and isolate projects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-development-settings-"));
  process.env.DB_PATH = join(dir, "db.sqlite");
  const { projects } = await import("../routes/projects.js");
  const { initDb, sequelize } = await import("../db.js");
  const { Project } = await import("../models/Project.js");
  const { Workspace } = await import("../models/Workspace.js");
  const { activeDevelopmentEnvironment, developmentEnvironmentContext } = await import("./developmentEnvironment.js");
  const { checkpointer } = await import("../agents/agents.js");
  await initDb();
  const first = await Project.create({ name: "first", githubRepo: "fixture/first", linearTeamId: "team-first" });
  const second = await Project.create({ name: "second", githubRepo: "fixture/second", linearTeamId: "team-second" });
  // An issue's workspace in each project.
  const inFirst = "11111111-1111-1111-1111-111111111111";
  const inSecond = "22222222-2222-2222-2222-222222222222";
  await Workspace.create({ issueId: inFirst, projectId: first.id });
  await Workspace.create({ issueId: inSecond, projectId: second.id });
  const app = express();
  app.use(express.json());
  app.use("/projects", projects);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const request = (method: string, body?: unknown, projectId = first.id) =>
    fetch(`http://127.0.0.1:${address.port}/projects/${projectId}/development-environment${method === "POST" ? "/import" : ""}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const secret = "synthetic-private-token-123";
    const imported = await request("POST", {
      content: `DEV_TOKEN=${secret}\nAPP_LABEL="two words"\nMULTILINE="one\ntwo"`,
    });
    assert.equal(imported.status, 200);
    const metadata = await imported.text();
    assert.ok(!metadata.includes(secret));
    assert.ok(!metadata.includes("two words"));
    assert.equal((await activeDevelopmentEnvironment(inFirst)).MULTILINE, "one\ntwo");
    assert.ok(!(await developmentEnvironmentContext(inFirst)).includes(secret));
    const { DevelopmentVariable } = await import("../models/DevelopmentVariable.js");
    assert.equal((await DevelopmentVariable.findOne({ where: { projectId: first.id, name: "DEV_TOKEN" } }))?.value, secret);
    assert.equal((await request("POST", { content: "NEW_VALUE=safe\nNODE_OPTIONS=--inspect" })).status, 400);
    assert.equal((await activeDevelopmentEnvironment(inFirst)).NEW_VALUE, undefined, "Invalid imports are atomic");
    assert.deepEqual(await activeDevelopmentEnvironment(inSecond), {}, "Another project's workspace has its own variables");
    assert.equal((await request("GET", undefined, 999)).status, 404);
    assert.equal(
      (
        await request("PUT", {
          variables: [
            { name: "DEV_TOKEN", value: "rotated" },
            { name: "MULTILINE", remove: true },
          ],
        })
      ).status,
      200,
    );
    assert.equal((await activeDevelopmentEnvironment(inFirst)).DEV_TOKEN, "rotated");
    assert.equal((await activeDevelopmentEnvironment(inFirst)).MULTILINE, undefined);
    assert.ok(!(await (await request("GET")).text()).includes("rotated"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    checkpointer.db.close();
    await sequelize.close();
    await rm(dir, { recursive: true, force: true });
  }
});
