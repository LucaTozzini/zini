import assert from "node:assert/strict";
import test from "node:test";
import type { ForgeLifecycleEvent } from "./events.js";
import { pipelineEvents } from "./pipelineEvents.js";
const plan = { steps: [], qaChecklist: [] };
import { Annotation, Command, END, MemorySaver, START, StateGraph, interrupt } from "@langchain/langgraph";

async function collect<T>(stream: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const chunk of stream) result.push(chunk);
  return result;
}

test("streaming chunks don't emit notifications; a saved interrupt emits one waiting event", async () => {
  const events: ForgeLifecycleEvent[] = [];
  const source = (async function* () {
    yield "first";
    yield "second";
  })();
  const stream = pipelineEvents(
    Promise.resolve(source),
    async () => ({ type: "waiting", waiting: { kind: "approve_plan", plan } }),
    async (event) => {
      events.push(event);
    },
  );
  assert.deepEqual(await collect(stream), ["first", "second"]);
  assert.deepEqual(events, [{ type: "waiting", waiting: { kind: "approve_plan", plan } }]);
});

test("completion and failure emit once; failure preserves the original exception", async () => {
  const events: ForgeLifecycleEvent[] = [];
  const emit = async (event: ForgeLifecycleEvent) => {
    events.push(event);
  };
  await collect(
    pipelineEvents(Promise.resolve((async function* () {})()), async () => ({ type: "completed", plan: null }), emit),
  );
  const failure = new Error("model unavailable");
  await assert.rejects(
    collect(
      pipelineEvents(
        Promise.resolve(
          (async function* () {
            throw failure;
          })(),
        ),
        async () => null,
        emit,
      ),
    ),
    (error) => error === failure,
  );
  assert.deepEqual(events, [
    { type: "completed", plan: null },
    { type: "failed", error: "model unavailable" },
  ]);
});

test("cancellation emits stopped after draining", async () => {
  {
    const events: ForgeLifecycleEvent[] = [];
    const control = new AbortController();
    let drained = false;
    const source = (async function* () {
      try {
        control.abort();
        throw new Error("aborted");
      } finally {
        drained = true;
      }
    })();
    await assert.rejects(
      collect(
        pipelineEvents(
          Promise.resolve(source),
          async () => null,
          async (event) => {
            assert.equal(drained, true);
            events.push(event);
          },
          control.signal,
        ),
      ),
    );
    assert.deepEqual(events, [{ type: "stopped" }]);
  }
});

test("a real graph emits a saved human request and completion on resume", async () => {
  const state = Annotation.Root({ finished: Annotation<boolean>() });
  const graph = new StateGraph(state)
    .addNode("approval", () => {
      interrupt({ kind: "approve_plan", plan });
      return { finished: true };
    })
    .addEdge(START, "approval")
    .addEdge("approval", END)
    .compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: "lifecycle" }, streamMode: "values" as const, durability: "sync" as const };
  const events: ForgeLifecycleEvent[] = [];
  const outcome = async (): Promise<ForgeLifecycleEvent | null> => {
    const snapshot = await graph.getState(config);
    if (snapshot.values.finished) return { type: "completed", plan: null };
    const request = snapshot.tasks.flatMap((task) => task.interrupts)[0]?.value;
    return request ? { type: "waiting", waiting: request as { kind: "approve_plan"; plan: typeof plan } } : null;
  };
  const emit = async (event: ForgeLifecycleEvent) => {
    events.push(event);
  };
  await collect(pipelineEvents(graph.stream({ finished: false }, config), outcome, emit));
  assert.deepEqual(events, [{ type: "waiting", waiting: { kind: "approve_plan", plan } }]);
  await collect(pipelineEvents(graph.stream(new Command({ resume: { approve: true } }), config), outcome, emit));
  assert.deepEqual(events, [
    { type: "waiting", waiting: { kind: "approve_plan", plan } },
    { type: "completed", plan: null },
  ]);
});
