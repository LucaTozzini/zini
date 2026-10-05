import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Annotation, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { setImmediate } from "node:timers/promises";
import { forgetRun, isRunning, pauseRun, startRun } from "../runs.js";
import { PipelineExecution } from "./execution.js";

test("a rebuilt pipeline continues its durable checkpoint without rerunning completed nodes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-recovery-"));
  let saved = SqliteSaver.fromConnString(join(dir, "checkpoints.sqlite"));
  let firstCalls = 0;
  let secondCalls = 0;
  let fail = true;
  const state = Annotation.Root({ done: Annotation<boolean>() });
  const build = () => new StateGraph(state)
    .addNode("first", () => { firstCalls++; return { done: false }; })
    .addNode("second", () => { secondCalls++; if (fail) throw new Error("interrupted"); return { done: true }; })
    .addEdge(START, "first").addEdge("first", "second").addEdge("second", END)
    .compile({ checkpointer: saved });
  const config = { configurable: { thread_id: "test" }, durability: "sync" as const };
  try {
    await assert.rejects(build().invoke({ done: false }, config), /interrupted/);
    saved.db.close();
    saved = SqliteSaver.fromConnString(join(dir, "checkpoints.sqlite"));
    assert.deepEqual((await build().getState(config)).next, ["second"]);
    fail = false;
    assert.equal((await build().invoke(null, config)).done, true);
    assert.equal(firstCalls, 1);
    assert.equal(secondCalls, 2);
    assert.deepEqual((await build().getState(config)).next, []);
  } finally { saved.db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("continuation with null does not approve a pending human request", async () => {
  const { MemorySaver } = await import("@langchain/langgraph");
  const state = Annotation.Root({ done: Annotation<boolean>() });
  let work = 0;
  const graph = new StateGraph(state).addNode("approval", () => {
    interrupt({ kind: "approve_plan" });
    work++;
    return { done: true };
  }).addEdge(START, "approval").addEdge("approval", END).compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: "approval" } };
  await graph.invoke({ done: false }, config);
  await graph.invoke(null, config);
  assert.equal(work, 0);
  assert.ok((await graph.getState(config)).tasks[0]?.interrupts.length);
});

test("graph cancellation does not unlock a node still unwinding", async () => {
  const { MemorySaver } = await import("@langchain/langgraph");
  const state = Annotation.Root({ done: Annotation<boolean>() });
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const drain = new Promise<void>((resolve) => { release = resolve; });
  const execution = new PipelineExecution();
  const graph = new StateGraph(state).addNode("work", () => execution.track(async () => {
    entered();
    await drain;
    return { done: true };
  })).addEdge(START, "work").addEdge("work", END).compile({ checkpointer: new MemorySaver() });
  const id = "graph-pause";
  try {
    await startRun(id, async (signal) => execution.stream(graph.stream({ done: false }, {
      configurable: { thread_id: id }, streamMode: "values", durability: "sync", signal,
    })), () => {});
    await started;
    assert.equal(pauseRun(id), true);
    await setImmediate();
    assert.equal(isRunning(id), true);
    release();
    for (let n = 0; n < 50 && isRunning(id); n++) await setImmediate();
    assert.equal(isRunning(id), false);
  } finally { release(); forgetRun(id); }
});
