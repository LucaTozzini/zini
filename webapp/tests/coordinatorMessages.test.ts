import assert from "node:assert/strict";
import test from "node:test";
import type { CoordinatorMessage } from "shared";
import { groupMessages } from "../src/components/coordinator-activity/groupMessages.ts";

test("tool groups preserve output and are separated by human messages and stage changes", () => {
  const tool = (id: string, agent: "coder" | "qa" = "coder"): CoordinatorMessage => ({ id, t: "t", agent,
    kind: "tool", call: { role: "tool", name: "read_file", args: {}, status: "done" }, result: id });
  const items = groupMessages([tool("1"), tool("2"),
    { id: "3", t: "t", agent: null, kind: "message", message: { role: "user", content: "Approved" } }, tool("4"), tool("5", "qa")]);
  assert.deepEqual(items.map((item) => item.kind), ["tools", "message", "tools", "tools"]);
  assert.equal(items[0]?.kind === "tools" && items[0].tools.length, 2);
  assert.equal(items[0]?.kind === "tools" && items[0].tools[1]?.result, "2");
});
