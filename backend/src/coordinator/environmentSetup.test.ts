import assert from "node:assert/strict";
import test from "node:test";
import { Annotation, Command, END, MemorySaver, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { EnvironmentSetupDocument, RepoCommand } from "shared";
import { environmentSetupNext, executeEnvironmentSetup } from "./environmentSetup.js";

const install: RepoCommand = { id: "install", kind: "setup", command: "npm ci", cwd: "web", purpose: "Install locked dependencies", sources: ["web/package-lock.json"] };
const fixtures: RepoCommand = { ...install, id: "fixtures", command: "npm run fixtures", purpose: "Prepare test data" };
const selection = { commands: [install, fixtures], blockingQuestions: [] };
const approve = { type: "approve" as const };
const passed = { exitCode: 0, status: "exited with code 0", output: "ready" };

test("setup follows dependency order and checks stay paused until recovery is approved", async () => {
  let prepared = false;
  const calls: string[] = [];
  let checks = 0;
  const state = Annotation.Root({ report: Annotation<EnvironmentSetupDocument | null>({ default: () => null, reducer: (_old, next) => next }) });
  const graph = new StateGraph(state)
    .addNode("execute_setup", async () => {
      const decisions = interrupt({ kind: "approve_commands", from: "setup" });
      return { report: await executeEnvironmentSetup(selection, decisions, "source", async (entry) => {
        calls.push(entry.command);
        return prepared ? passed : { exitCode: 1, status: "exited with code 1", output: "Registry unavailable" };
      }) };
    })
    .addNode("ask_setup_failure", () => { interrupt({ kind: "questions", from: "setup" }); return {}; })
    .addNode("checks", () => { checks++; assert.ok(prepared); return {}; })
    .addEdge(START, "execute_setup")
    .addConditionalEdges("execute_setup", ({ report }) => environmentSetupNext(report))
    .addEdge("ask_setup_failure", "execute_setup").addEdge("checks", END)
    .compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: "environment" } };
  await graph.invoke({}, config);
  assert.deepEqual(calls, []);
  await graph.invoke(new Command({ resume: [approve, approve] }), config);
  assert.deepEqual(calls, ["npm ci"]);
  assert.equal(checks, 0);
  assert.deepEqual((await graph.getState(config)).next, ["ask_setup_failure"]);
  prepared = true;
  await graph.invoke(new Command({ resume: { answers: ["Registry restored; retry"] } }), config);
  assert.equal(checks, 0);
  assert.deepEqual(calls, ["npm ci"]);
  await graph.invoke(new Command({ resume: [approve, approve] }), config);
  assert.deepEqual(calls, ["npm ci", "npm ci", "npm run fixtures"]);
  assert.equal(checks, 1);
  assert.equal((await graph.getState(config)).values.report.complete, true);
});

test("rejected or unapproved setup never runs subsequent commands", async () => {
  for (const decisions of [[{ type: "reject" as const, message: "Need an offline install" }], []]) {
    let calls = 0;
    const report = await executeEnvironmentSetup(selection, decisions, "rev", async () => { calls++; return passed; });
    assert.equal(calls, 0);
    assert.equal(report.complete, false);
    assert.equal(report.results[0]?.status, "blocked");
    assert.equal(environmentSetupNext(report), "ask_setup_failure");
  }
});
