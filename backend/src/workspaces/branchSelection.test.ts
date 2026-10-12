import test from "node:test";
import assert from "node:assert/strict";
import { selectWorkspaceBranch as select, WorkspaceChoiceRequired } from "./branchSelection.js";

const pull = (number: number, state: "open" | "closed" | "merged" = "open") => ({ number, state,
  url: `https://github.com/owner/repo/pull/${number}`, title: "Existing implementation", body: "Context", branch: `actual-${number}`,
  head: "abc", headRepo: "owner/repo", base: "release" });

test("linked open PR wins over suggested branch; base and existing head branch are retained", () => {
  const result = select("ENG-1", "main", ["ENG-1", "actual-1"], [pull(1)], null);
  assert.equal(result.branch, "actual-1"); assert.equal(result.target, "release"); assert.equal(result.reuse, true);
});
test("new issues create branches, exact pre-PR branches resume, completed work gets a fresh name", () => {
  assert.equal(select("ENG-1", "main", [], [], null).reuse, false);
  assert.equal(select("ENG-1", "main", ["ENG-1"], [], null).reuse, true);
  assert.equal(select("ENG-1", "main", ["ENG-1", "ENG-1-2"], [pull(1, "merged")], null).branch, "ENG-1-3");
  assert.equal(select("ENG-1", "main", ["ENG-1"], [], pull(1, "merged")).reuse, false);
});
test("ambiguous or abandoned work requires a choice, which is revalidated on retry", () => {
  assert.throws(() => select("ENG-1", "main", [], [pull(1), pull(2)], null), WorkspaceChoiceRequired);
  assert.throws(() => select("ENG-1", "main", [], [pull(1, "closed")], null), WorkspaceChoiceRequired);
  assert.equal(select("ENG-1", "main", [], [pull(1, "closed")], null, { pullRequest: 1 }).branch, "actual-1");
  assert.equal(select("ENG-1", "main", [], [pull(1)], null, { fresh: true }).pull, null);
  assert.throws(() => select("ENG-1", "main", [], [pull(1, "merged")], null, { pullRequest: 1 }), /no longer available/);
});
