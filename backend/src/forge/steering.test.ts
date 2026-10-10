import assert from "node:assert/strict";
import test from "node:test";
import { Annotation, END, MemorySaver, START, StateGraph, interrupt } from "@langchain/langgraph";
import { redirectUpdate, readRedirect, steeringOptions } from "./steering.js";
import { forgetRun, isRunning, startRun, withPausedRun } from "../agents/runs.js";
import type { State } from "./graphState.js";

const prepared = {
  plan: { summary: "Plan", steps: [], blockingQuestions: [] }, planApproved: true, implementation: { blockingQuestions: [] },
  environmentReport: { revision: "revision", results: [], complete: true, blockingQuestions: [] }, checksReport: { revision: "revision", results: [], complete: true },
  review: { blockingQuestions: [], requiredChanges: [] },
} satisfies Partial<State>;

test("steering rejects forward jumps and missing prerequisites, and clears downstream results", () => {
  assert.ok(steeringOptions(prepared, "planner", true).find((o) => o.target === "coder")?.reason);
  assert.ok(steeringOptions({ ...prepared, planApproved: false }, "qa", true).find((o) => o.target === "coder")?.reason);
  assert.ok(steeringOptions({ ...prepared, checksReport: null }, "reviewer", true).find((o) => o.target === "reviewer")?.reason);
  assert.ok(steeringOptions({ ...prepared, review: { blockingQuestions: [], requiredChanges: ["Fix it"] } }, "qa", true).find((o) => o.target === "qa")?.reason);
  assert.ok(steeringOptions({}, null, false).every((o) => o.reason));
  assert.ok(steeringOptions(prepared, "qa", true).every((o) => !o.reason));
  const update = redirectUpdate({ target: "coder", feedback: "Change the color" });
  assert.equal(update.plan, undefined);
  assert.equal(update.implementation, null);
  assert.equal(update.environmentReport, null);
  assert.equal(update.checksReport, null);
  assert.equal(update.review, null);
  assert.equal(update.qaReport, null);
  assert.deepEqual(update.implementationFeedback, ["Change the color"]);
  assert.equal(redirectUpdate({ target: "planner", feedback: "New plan" }).planApproved, false);
  assert.equal(readRedirect({ target: "setup", feedback: "x" }), null);
  assert.equal(readRedirect({ target: "coder", feedback: " " }), null);
});

test("routing checkpoint replaces an approval instead of resuming the old task", async () => {
  const state = Annotation.Root({ redirectTarget: Annotation<"coder" | "qa" | "approval">(), feedback: Annotation<string>() });
  const calls: string[] = [];
  const graph = new StateGraph(state)
    .addNode("redirect", () => ({}))
    .addNode("approval", () => { interrupt("approve old QA command"); calls.push("old command"); return {}; })
    .addNode("coder", (s) => { calls.push(`coder: ${s.feedback}`); return {}; })
    .addNode("qa", () => { calls.push("qa"); return {}; })
    .addConditionalEdges("redirect", (s) => s.redirectTarget, ["coder", "qa", "approval"])
    .addEdge(START, "redirect").addEdge("approval", END).addEdge("coder", "qa").addEdge("qa", END)
    .compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: "steer" } };
  await graph.invoke({ redirectTarget: "approval", feedback: "" }, config);
  assert.ok((await graph.getState(config)).tasks[0]?.interrupts.length);
  await graph.updateState(config, { redirectTarget: "coder", feedback: "New change" }, "redirect");
  assert.deepEqual((await graph.getState(config)).next, ["coder"]);
  await graph.invoke(null, config);
  assert.deepEqual(calls, ["coder: New change", "qa"]);
});

test("redirect reservation drains the run and blocks competing starts and redirects", async () => {
  const id = "steering-drain";
  let release!: () => void;
  let entered!: () => void;
  const draining = new Promise<void>((resolve) => { release = resolve; });
  const working = new Promise<void>((resolve) => { entered = resolve; });
  try {
    await startRun(id, async () => (async function* () { yield {}; entered(); await draining; })(), () => {});
    await working;
    const redirect = withPausedRun(id, () => {}, async (reservation) => {
      assert.equal(isRunning(id), true); // reservation still holds the slot
      assert.equal(await startRun(id, async () => (async function* () { yield {}; })(), () => {}, reservation), true);
    });
    assert.equal(await startRun(id, async () => (async function* () { yield {}; })(), () => {}), false);
    await assert.rejects(withPausedRun(id, () => {}, async () => {}), /already redirecting/);
    release();
    await redirect;
  } finally { release(); forgetRun(id); }
});

// The planner/coder use shared child checkpoints; top-level routing tests alone
// cannot catch a parent's resume flag silently suppressing their new input.
test("redirect starts a new turn in a remembered subagent and retains its history", async () => {
  const state = Annotation.Root({ turns: Annotation<string[]>({ reducer: (old, more) => old.concat(more), default: () => [] }) });
  const inputs: string[][] = [];
  const child = new StateGraph(state).addNode("model", (s) => { inputs.push(s.turns); return {}; })
    .addEdge(START, "model").addEdge("model", END).compile({ checkpointer: true });
  let feedback = "Initial task";
  const parent = new StateGraph(state).addNode("redirect", () => ({}))
    .addNode("coder", async () => {
      await child.invoke({ turns: [feedback] }, { configurable: { __pregel_resuming: false } });
      return {};
    }).addEdge(START, "redirect").addEdge("redirect", "coder").addEdge("coder", END)
    .compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: "remembered-steering" } };
  await parent.invoke({ turns: [] }, config);
  feedback = "Hide email address";
  await parent.updateState(config, {}, "redirect");
  await parent.invoke(null, config);
  assert.deepEqual(inputs, [["Initial task"], ["Initial task", "Hide email address"]]);
});
