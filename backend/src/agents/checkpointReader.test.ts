import assert from "node:assert/strict";
import test from "node:test";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { CachedCheckpointReader, LatestCheckpointSaver } from "./agents.js";

test("the reader reuses a parsed checkpoint until the thread's checkpoint or pending writes change", async () => {
  const { db } = SqliteSaver.fromConnString(":memory:");
  const saver = new LatestCheckpointSaver(db);
  const reader = new CachedCheckpointReader(db);
  const config = { configurable: { thread_id: "forge:test", checkpoint_ns: "" } };
  const put = (n: number, messages: string[]) =>
    saver.put(
      config,
      {
        v: 4,
        id: String(n).padStart(8, "0"),
        ts: new Date(n * 1000).toISOString(),
        channel_values: { messages },
        channel_versions: {},
        versions_seen: {},
      },
      { source: "loop", step: n, parents: {} },
    );
  const messages = async () => (await reader.getTuple(config))?.checkpoint.channel_values.messages;

  assert.equal(await reader.getTuple(config), undefined, "Nothing saved yet");
  const first = await put(1, ["one"]);
  assert.deepEqual(await messages(), ["one"]);
  const read = await reader.getTuple(config);
  assert.equal(await reader.getTuple(config), read, "Unchanged: the same parsed tuple");

  await saver.putWrites(first, [["messages", ["pending"]]], "task");
  const withWrite = await reader.getTuple(config);
  assert.notEqual(withWrite, read, "A pending write is read");
  assert.equal(withWrite?.pendingWrites?.length, 1);

  await put(2, ["one", "two"]);
  assert.deepEqual(await messages(), ["one", "two"], "A new checkpoint is read");
  assert.equal(await reader.getTuple({ configurable: { thread_id: "forge:other" } }), undefined, "Threads are kept apart");
});
