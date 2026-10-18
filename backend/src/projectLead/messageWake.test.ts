import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("the message worker is woken when messages are queued and when a chat's run ends", async (t) => {
  process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), "zini-wake-")), "wake.sqlite");
  const { sequelize, initDb } = await import("../db.js");
  const { ProjectLeadThread } = await import("../models/ProjectLeadThread.js");
  const { enqueueMessages, onEnqueue } = await import("./messageQueue.js");
  const { onRunEnd, startRun, stopRun } = await import("../agents/runs.js");
  await initDb();
  await ProjectLeadThread.create({ id: "chat", title: "chat" });
  const message = { eventId: "e1", source: "forge", sourceId: "issue", eventType: "completed", content: "Done" };

  await t.test("queued: once its transaction commits, never when it rolls back", async () => {
    let woken = 0;
    const stop = onEnqueue(() => woken++);
    await sequelize
      .transaction(async (transaction) => {
        await enqueueMessages(["chat"], { ...message, eventId: "rolled-back" }, transaction);
        throw new Error("roll back");
      })
      .catch(() => {});
    assert.equal(woken, 0);
    await sequelize.transaction(async (transaction) => {
      await enqueueMessages(["chat"], message, transaction);
      assert.equal(woken, 0, "Not before the commit");
    });
    assert.equal(woken, 1);
    await enqueueMessages(["chat"], { ...message, eventId: "e2" });
    assert.equal(woken, 2, "Without a transaction, right away");
    stop();
  });

  await t.test("a run that ends, and one that's stopped", async () => {
    const ended: string[] = [];
    const stop = onRunEnd((runId) => ended.push(runId));
    const steps = (count: number) =>
      (async function* () {
        for (let i = 0; i < count; i++) yield i;
      })();
    assert.equal(
      await startRun(
        "chat",
        async () => steps(2),
        () => {},
      ),
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(ended, ["chat"]);

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await startRun(
      "chat",
      async () =>
        (async function* () {
          yield 0;
          await held;
        })(),
      () => {},
    );
    assert.equal(stopRun("chat"), true);
    assert.deepEqual(ended, ["chat", "chat"]);
    release();
    stop();
  });
  await sequelize.close();
});
