import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

test("development Settings import, conceal values, isolate repositories and reject stale writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-development-settings-"));
  process.env.DB_PATH = join(dir, "db.sqlite");
  const { settings } = await import("../routes/settings.js");
  const { initDb, sequelize } = await import("../db.js");
  const { saveSettings } = await import("./settings.js");
  const { activeDevelopmentEnvironment, developmentEnvironmentContext } = await import("./developmentEnvironment.js");
  const { checkpointer } = await import("../agents/agents.js");
  await initDb();
  await saveSettings({ githubRepo: "fixture/first" });
  const app = express();
  app.use(express.json());
  app.use("/settings", settings);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const request = (method: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${address.port}/settings/development-environment${method === "POST" ? "/import" : ""}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const secret = "synthetic-private-token-123";
    const imported = await request("POST", {
      repository: "fixture/first",
      content: `DEV_TOKEN=${secret}\nAPP_LABEL="two words"\nMULTILINE="one\ntwo"`,
    });
    assert.equal(imported.status, 200);
    const metadata = await imported.text();
    assert.ok(!metadata.includes(secret));
    assert.ok(!metadata.includes("two words"));
    assert.equal((await activeDevelopmentEnvironment()).MULTILINE, "one\ntwo");
    assert.ok(!(await developmentEnvironmentContext()).includes(secret));
    const { DevelopmentVariable } = await import("../models/DevelopmentVariable.js");
    assert.equal(
      (await DevelopmentVariable.findOne({ where: { repository: "fixture/first", name: "DEV_TOKEN" } }))?.value,
      secret,
    );
    assert.equal(
      (await request("POST", { repository: "fixture/first", content: "NEW_VALUE=safe\nNODE_OPTIONS=--inspect" })).status,
      400,
    );
    assert.equal((await activeDevelopmentEnvironment()).NEW_VALUE, undefined, "Invalid imports are atomic");
    await saveSettings({ githubRepo: "fixture/second" });
    assert.deepEqual(await activeDevelopmentEnvironment(), {});
    assert.equal(
      (await request("PUT", { repository: "fixture/first", variables: [{ name: "DEV_TOKEN", remove: true }] })).status,
      409,
    );
    await saveSettings({ githubRepo: "fixture/first" });
    assert.equal(
      (
        await request("PUT", {
          repository: "fixture/first",
          variables: [
            { name: "DEV_TOKEN", value: "rotated" },
            { name: "MULTILINE", remove: true },
          ],
        })
      ).status,
      200,
    );
    assert.equal((await activeDevelopmentEnvironment()).DEV_TOKEN, "rotated");
    assert.equal((await activeDevelopmentEnvironment()).MULTILINE, undefined);
    assert.ok(!(await (await request("GET")).text()).includes("rotated"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    checkpointer.db.close();
    await sequelize.close();
    await rm(dir, { recursive: true, force: true });
  }
});
