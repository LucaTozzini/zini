import assert from "node:assert/strict";
import test from "node:test";
import { ForgeSubscriptions, forgeSnapshot, type ForgeUpdate } from "./forgeSubscriptions.js";
import type { PipelineState } from "shared";

const snapshot = (key: string) => ({ key, eventType: "stage_changed", content: key });

test("queues for each subscribed chat, waits while busy, and retries the same event ID", async () => {
  const subscriptions = new ForgeSubscriptions();
  subscriptions.subscribe("busy", "issue");
  subscriptions.subscribe("idle", "issue");
  const attempts: Record<string, ForgeUpdate[][]> = { busy: [], idle: [] };
  let blocked = true;
  const deliver = async (id: string, events: ForgeUpdate[]) => {
    attempts[id]!.push(events);
    return id === "idle" || !blocked;
  };
  await subscriptions.tick(async () => snapshot("coder"), deliver);
  await subscriptions.tick(async () => snapshot("coder"), deliver);
  assert.equal(attempts.idle!.length, 1);
  assert.equal(attempts.busy![0]![0]!.eventId, attempts.busy![1]![0]!.eventId);
  assert.equal(attempts.idle![0]![0]!.eventId, attempts.busy![0]![0]!.eventId);
  blocked = false;
  await subscriptions.tick(async () => snapshot("qa"), deliver);
  assert.deepEqual(attempts.busy![2]!.map((event) => event.content), ["coder", "qa"]);
  await subscriptions.tick(async () => snapshot("qa"), deliver);
  assert.equal(attempts.busy!.length, 3);
});

test("unsubscribe removes queued deliveries and is isolated to the calling chat", async () => {
  const subscriptions = new ForgeSubscriptions();
  subscriptions.subscribe("one", "issue");
  subscriptions.subscribe("two", "issue");
  await subscriptions.tick(async () => snapshot("planner"), async () => false);
  subscriptions.unsubscribe("one", "issue");
  const delivered: string[] = [];
  await subscriptions.tick(async () => snapshot("planner"), async (id) => { delivered.push(id); return true; });
  assert.deepEqual(delivered, ["two"]);
  assert.deepEqual(subscriptions.list("one"), []);
  assert.deepEqual(subscriptions.list("two"), ["issue"]);
  subscriptions.forget("two");
  assert.deepEqual(subscriptions.list("two"), []);
});

test("Stop pauses delivery until a human turn resumes it", async () => {
  const subscriptions = new ForgeSubscriptions();
  subscriptions.subscribe("chat", "issue");
  subscriptions.pause("chat");
  let calls = 0;
  const deliver = async () => { calls++; return true; };
  await subscriptions.tick(async () => snapshot("coder"), deliver);
  assert.equal(calls, 0);
  subscriptions.resume("chat");
  await subscriptions.tick(async () => snapshot("coder"), deliver);
  assert.equal(calls, 1);
});

test("overlapping notifications don't start parallel deliveries; a failing chat doesn't block another", async () => {
  const subscriptions = new ForgeSubscriptions();
  subscriptions.subscribe("bad", "issue");
  subscriptions.subscribe("good", "issue");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  const read = async () => { reads++; await waiting; return snapshot("qa"); };
  const delivered: string[] = [];
  const errors: unknown[] = [];
  const deliver = async (id: string) => {
    if (id === "bad") throw new Error("unavailable");
    delivered.push(id); return true;
  };
  const first = subscriptions.tick(read, deliver, (error) => errors.push(error));
  await subscriptions.tick(read, deliver);
  release();
  await first;
  assert.equal(reads, 1);
  assert.deepEqual(delivered, ["good"]);
  assert.equal(errors.length, 1);
});

const pipeline: PipelineState = {
  started: true, running: "coder", waiting: null, plan: null, planApproved: true,
  implementation: null, review: null, qa: null, clarifications: [], browserUrl: null,
  finished: false, error: null,
};

test("meaningful snapshots include questions and completion while ignoring changing browser state", () => {
  assert.equal(forgeSnapshot(pipeline)?.key,
    forgeSnapshot({ ...pipeline, browserUrl: "http://localhost/page" })?.key);
  assert.equal(forgeSnapshot({ ...pipeline, running: null }), null);
  const questions = forgeSnapshot({ ...pipeline, running: null,
    waiting: { kind: "questions", from: "planner", questions: ["Which layout?"] } });
  assert.match(questions!.content, /Which layout/);
  const done = forgeSnapshot({ ...pipeline, finished: true, running: null,
    waiting: null, qa: { verdict: "partial", failures: [], couldNotTest: ["Mobile browser"],
      blockingQuestions: [], coverage: [] } });
  assert.equal(done?.eventType, "completed");
  assert.match(done!.content, /partial/);
  assert.match(done!.content, /Mobile browser/);
});
