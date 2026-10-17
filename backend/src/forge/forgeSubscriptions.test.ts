import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Sequelize, Transaction, Op } from "sequelize";

test("durable subscriptions and source-agnostic PL queues", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zini-queue-"));
  process.env.DB_PATH = join(directory, "queue.sqlite");
  const { sequelize, initDb } = await import("../db.js");
  const { ProjectLeadThread } = await import("../models/ProjectLeadThread.js");
  const { ForgeSubscription } = await import("../models/ForgeSubscription.js");
  const { ProjectLeadQueueMessage: Queue } = await import("../models/ProjectLeadQueueMessage.js");
  const { forgeSubscriptions: subscriptions } = await import("./forgeSubscriptions.js");
  const { emitForgeEvent, forgeEventContent } = await import("./events.js");
  const { enqueueMessages, claimMessages, finishClaim, recoverMessageQueue, drainMessageQueue } = await import("../projectLead/messageQueue.js");
  await initDb();
  let closed = false;
  try {
    await ProjectLeadThread.bulkCreate(["one", "two", "empty"].map((id) => ({ id, title: id })));
    await t.test("unique subscriptions and unchanged API shape", async () => {
      assert.deepEqual(await subscriptions.listAll(), []);
      await subscriptions.subscribe("one", "issue-a");
      await subscriptions.subscribe("one", "issue-a");
      await subscriptions.subscribe("one", "issue-b");
      await subscriptions.subscribe("two", "issue-a");
      assert.deepEqual(await subscriptions.listAll(), [
        { threadId: "one", forgeIds: ["issue-a", "issue-b"] },
        { threadId: "two", forgeIds: ["issue-a"] },
      ]);
    });
    await t.test("explicit events fan out once per recipient, including after acknowledgement", async () => {
      await emitForgeEvent("issue-a", { type: "stage_started", role: "coder" }, "event-a");
      await emitForgeEvent("issue-a", { type: "stage_started", role: "coder" }, "event-a");
      assert.equal(await Queue.count(), 2);
      const claim = (await claimMessages("one"))!;
      assert.equal(await claimMessages("one"), null);
      assert.equal(claim.messages[0]!.eventId, "event-a");
      await finishClaim(claim.claimToken, true);
      await emitForgeEvent("issue-a", { type: "stage_started", role: "coder" }, "event-a");
      assert.equal(await Queue.count(), 2);
      assert.equal(await Queue.count({ where: { threadId: "one", status: "delivered" } }), 1);
    });
    await t.test("concurrent lifecycle notifications wait for a queue writer without losing or duplicating events", async () => {
      const writer = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE });
      await Queue.update({ content: "Writer holds queue lock" }, { where: { eventId: "event-a" }, transaction: writer });
      const ids = Array.from({ length: 8 }, (_, index) => `lock-event-${index}`);
      const emitting = Promise.all(ids.map(id => emitForgeEvent("issue-b", { type: "stage_started", role: "lead" }, id)));
      const release = new Promise<void>((resolve, reject) => {
        setTimeout(() => { void writer.commit().then(resolve, reject); }, 50);
      });
      await Promise.all([emitting, release]);
      await Promise.all(ids.map(id => emitForgeEvent("issue-b", { type: "stage_started", role: "lead" }, id)));
      assert.equal(await Queue.count({ where: { eventId: { [Op.in]: ids } } }), ids.length);
      await Queue.destroy({ where: { eventId: { [Op.in]: ids } } });
    });
    await t.test("busy recipients wait; failed deliveries retry the same IDs; other sources are accepted", async () => {
      await enqueueMessages(["one"], { eventId: "external", source: "scheduler", sourceId: "job", eventType: "reminder", content: "Review progress" });
      const attempted: string[] = [];
      const errors: unknown[] = [];
      await drainMessageQueue(async (id) => id !== "two", async (id, messages) => {
        attempted.push(id);
        assert.equal(messages[0]!.eventId, "external");
        throw new Error("temporary failure");
      }, (error) => errors.push(error));
      assert.deepEqual(attempted, ["one"]);
      assert.equal(errors.length, 1);
      assert.equal(await Queue.count({ where: { status: "pending" } }), 2);
      await drainMessageQueue(async () => true, async () => true);
      assert.equal(await Queue.count({ where: { status: "pending" } }), 0);
    });
    await t.test("startup recovers interrupted claims and preserves FIFO", async () => {
      await emitForgeEvent("issue-b", { type: "stage_started", role: "lead" }, "first");
      await emitForgeEvent("issue-b", { type: "waiting", waiting: { kind: "approve_plan", plan: { steps: [], qaChecklist: [] } } }, "second");
      const original = (await claimMessages("one"))!;
      assert.deepEqual(original.messages.map((message) => message.eventId), ["first", "second"]);
      await recoverMessageQueue();
      const recovered = (await claimMessages("one"))!;
      assert.notEqual(recovered.claimToken, original.claimToken);
      assert.deepEqual(recovered.messages.map((message) => message.eventId), ["first", "second"]);
      await finishClaim(original.claimToken, true);
      assert.equal(await Queue.count({ where: { status: "processing" } }), 2);
      await finishClaim(recovered.claimToken, false);
    });
    await t.test("overlapping workers cannot deliver the same PL batch", async () => {
      await enqueueMessages(["empty"], { eventId: "concurrent", source: "scheduler", sourceId: "job", eventType: "reminder", content: "Once" });
      let entered!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let deliveries = 0;
      const first = drainMessageQueue(async (id) => id === "empty", async (_id, messages) => {
        assert.deepEqual(Object.keys(messages[0]!).sort(), ["content", "eventId", "eventType", "source", "sourceId"]);
        deliveries++; entered(); await held; return true;
      });
      await started;
      try {
        await drainMessageQueue(async (id) => id === "empty", async () => { deliveries++; return true; });
        assert.equal(deliveries, 1);
      } finally { release(); await first; }
    });
    await t.test("unsubscribe clears pending Forge messages but preserves other sources", async () => {
      await enqueueMessages(["one"], { eventId: "keep", source: "scheduler", sourceId: "issue-b", eventType: "reminder", content: "Keep me" });
      await subscriptions.unsubscribe("one", "issue-b");
      assert.equal(await Queue.count({ where: { threadId: "one", source: "forge", sourceId: "issue-b", status: "pending" } }), 0);
      assert.equal(await Queue.count({ where: { eventId: "keep" } }), 1);
      assert.deepEqual(await subscriptions.list("one"), ["issue-a"]);
    });
    await t.test("thread deletion cascades to subscriptions and messages", async () => {
      await ProjectLeadThread.destroy({ where: { id: "two" } });
      assert.equal(await ForgeSubscription.count({ where: { threadId: "two" } }), 0);
      assert.equal(await Queue.count({ where: { threadId: "two" } }), 0);
    });
    await t.test("notification payloads preserve questions, completion details and failures", () => {
      assert.match(forgeEventContent({ type: "waiting", waiting: { kind: "questions", questions: ["Which layout?"] } }), /Which layout/);
      assert.match(forgeEventContent({ type: "completed", plan: { steps: [], qaChecklist: [
        { id: "Q1", condition: "Page loads", status: "failed", note: "Broken page" },
        { id: "Q2", condition: "Works on mobile", status: "skipped", note: "No device" }] } }), /failed: Page loads \(Broken page\)\n- skipped: Works on mobile/);
      assert.equal(forgeEventContent({ type: "failed", error: "Timeout" }), "Forge failed: Timeout");
    });
    await sequelize.close();
    closed = true;
    const reopened = new Sequelize({ dialect: "sqlite", storage: process.env.DB_PATH, logging: false });
    try {
      const [rows] = await reopened.query("SELECT * FROM project_lead_subscriptions");
      assert.equal(rows.length, 1);
      const [messages] = await reopened.query("SELECT * FROM project_lead_message_queue WHERE eventId = 'keep'");
      assert.equal(messages.length, 1);
    } finally { await reopened.close(); }
  } finally {
    if (!closed) await sequelize.close();
    await rm(directory, { recursive: true, force: true });
  }
});
