import assert from "node:assert/strict";
import test from "node:test";

test("settings changes notify after persistence; failed writes do not notify", async (t) => {
  process.env.DB_PATH = ":memory:";
  const { sequelize, initDb } = await import("../db.js");
  const { Setting } = await import("../models/Setting.js");
  const { getSetting, onSettingsSaved, saveSettings } = await import("./settings.js");
  await initDb();
  const notifications: string[] = [];
  let persisted: Promise<string | null> | undefined;
  const unsubscribe = onSettingsSaved((changes) => {
    notifications.push(changes.conductorEnabled!);
    persisted = getSetting("conductorEnabled");
  });
  try {
    await saveSettings({ conductorEnabled: "false" });
    assert.deepEqual(notifications, ["false"]);
    assert.equal(await persisted, "false");
    const failure = t.mock.method(Setting, "upsert", async () => { throw new Error("write failed"); });
    await assert.rejects(saveSettings({ conductorEnabled: "true" }), /write failed/);
    assert.deepEqual(notifications, ["false"]);
    failure.mock.restore();
    unsubscribe();
    await saveSettings({ conductorEnabled: "true" });
    assert.deepEqual(notifications, ["false"]);
  } finally { unsubscribe(); await sequelize.close(); }
});
