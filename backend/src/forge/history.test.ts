import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { LatestCheckpointSaver } from "../agents/agents.js";
import { loadForgeHistory } from "./history.js";
import { forgeMessages } from "./messages.js";
import { timestampedSerializer } from "../agents/messageTimestamps.js";

test("only the latest checkpoint is kept, with its pending writes and first-saved timestamps", async () => {
  const saver = new LatestCheckpointSaver(SqliteSaver.fromConnString(":memory:").db);
  saver.serde = timestampedSerializer(saver.serde);
  const thread = "forge:test:coder";
  const put = async (n: number, values: Record<string, unknown>) =>
    saver.put({ configurable: { thread_id: thread, checkpoint_ns: "" } }, {
      v: 4, id: String(n).padStart(8, "0"), ts: new Date(n * 1000).toISOString(),
      channel_values: values, channel_versions: {}, versions_seen: {},
    }, { source: "loop", step: n, parents: {} });
  const first = new AIMessage({ id: "first", content: "Implemented." });
  try {
    const old = await put(1, { messages: [first] });
    await saver.putWrites(old, [["messages", [new ToolMessage({ tool_call_id: "x", content: "Old" })]]], "old-task");
    const firstTime = first.additional_kwargs.createdAt;
    assert.equal(typeof firstTime, "string");
    const reading = new AIMessage({ id: "reading", content: "Reading", tool_calls: [{ id: "read", name: "read_file", args: { path: "/a" } }] });
    const live = await put(2, { messages: [first, reading] });
    await saver.putWrites(live, [["messages", [new ToolMessage({ tool_call_id: "read", content: "Live result" })]]], "live-task");
    const { checkpoints } = await loadForgeHistory(saver, thread);
    assert.equal(checkpoints.length, 1);
    assert.equal((saver.db.prepare("SELECT count(*) AS n FROM writes WHERE checkpoint_id = ?").get(old.configurable?.checkpoint_id) as { n: number }).n, 0);
    const items = forgeMessages([{ agent: "coder", checkpoint: checkpoints[0] }], "coder");
    assert.equal(items.find((item) => item.kind === "message" && item.message.role === "assistant" && item.message.content === "Implemented.")?.t, firstTime);
    assert.ok(items.some((item) => item.kind === "tool" && item.result === "Live result" && item.call.status === "done"));
  } finally { saver.db.close(); }
});
