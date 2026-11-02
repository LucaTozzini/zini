import assert from "node:assert/strict";
import test from "node:test";
import type { ForgeState } from "shared";
import { listForges } from "./listForges.js";

const forge: ForgeState = {
  started: true,
  running: "coder",
  waiting: null,
  plan: null,
  planApproved: true,
  browserUrl: null,
  pullRequest: null,
  error: null,
};
const plan = {
  revision: 1,
  design: "",
  mockups: [],
  steps: [],
  qaChecklist: [
    { id: "Q1", condition: "Loads", status: "passed" as const, note: "" },
    { id: "Q2", condition: "Saves", status: "todo" as const, note: "" },
  ],
};

test("discovers workspaces and subscriptions without workspaces, preserving status and avoiding duplicates", async () => {
  const rows = await listForges([{ issueId: "running" }, { issueId: "failed" }], ["running", "missing"], async (id) =>
    id === "running" ? forge : { ...forge, started: false, running: null },
  );
  assert.deepEqual(
    rows.map((row) => row.issueId),
    ["running", "failed", "missing"],
  );
  assert.equal(rows[0]?.subscribed, true);
  assert.equal(rows[0]?.running, "coder");
  assert.equal(rows[1]?.subscribed, false);
  assert.equal(rows[2]?.hasWorkspace, false);
  assert.equal(rows[2]?.subscribed, true);
  assert.equal(rows[2]?.started, false);
});

test("subscribedOnly excludes other workspaces and retains approvals and completion", async () => {
  const read: string[] = [];
  const rows = await listForges(
    [{ issueId: "other" }, { issueId: "watched" }],
    ["watched", "done"],
    async (id) => {
      read.push(id);
      return id === "watched"
        ? { ...forge, running: null, waiting: { kind: "questions" as const, questions: ["Which list?"] } }
        : {
            ...forge,
            running: null,
            pullRequest: { number: 7, url: "https://github.com/acme/app/pull/7", state: "open" as const },
            plan,
          };
    },
    true,
  );
  assert.deepEqual(read, ["watched", "done"]);
  assert.ok(rows.every((row) => row.subscribed));
  assert.deepEqual(rows[0]?.waiting, { kind: "questions", questions: ["Which list?"] });
  assert.equal(rows[1]?.pullRequest?.number, 7);
  assert.equal(rows[1]?.qaVerdict, "partial");
});
