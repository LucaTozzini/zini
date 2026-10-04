import test from "node:test";
import assert from "node:assert/strict";
import type { ChecksDocument, QaDocument, RepoCommand } from "shared";
import { canReuseCheckSelection, enforceCoverage, freshRunbook, updateRunbook } from "./validation.js";
import { completeDocument } from "./completion.js";
import { isModelRateLimit } from "../modelErrors.js";

test("runbook preserves commands for different packages and invalidates edited sources", async () => {
  const files = new Map([["Makefile", "a"], ["python/pyproject.toml", "b"]]);
  const fingerprint = async (path: string) => files.get(path) ?? null;
  const commands: RepoCommand[] = [
    { id: "build", command: "make build", cwd: ".", kind: "check", purpose: "Build", sources: ["Makefile"] },
    { id: "test", command: "uv run pytest", cwd: "python", kind: "check", purpose: "Python tests", sources: ["python/pyproject.toml"] },
  ];
  const book = await updateRunbook({}, commands, fingerprint);
  const selection = { commands, blockingQuestions: [] };
  assert.equal(canReuseCheckSelection(selection, book), true);
  assert.equal(canReuseCheckSelection(null, book), false);
  assert.equal(canReuseCheckSelection({ ...selection, blockingQuestions: ["Which credentials?"] }, book), false);
  assert.equal(book.test?.cwd, "python");
  files.set("Makefile", "changed");
  const partialBook = await freshRunbook(book, fingerprint);
  assert.deepEqual(Object.keys(partialBook), ["test"]);
  assert.equal(canReuseCheckSelection(selection, partialBook), false);
  assert.equal(Object.keys(await updateRunbook(book, [{ ...commands[0]!, sources: ["missing"] }], fingerprint)).length, 1);
});

const report: QaDocument = { verdict: "pass", checks: [], failures: [], couldNotTest: [], blockingQuestions: [], coverage: [] };
const checks: ChecksDocument = { revision: "v1", complete: true, results: [], couldNotTest: [] };
const criteria = [{ id: "c1", requirement: "CLI returns the result", source: "Returns the result" }];
test("a pass needs complete checks and evidence for every criterion", () => {
  assert.equal(enforceCoverage(report, criteria, checks).verdict, "partial");
  const covered = { ...report, coverage: [{ criterionId: "c1", status: "pass" as const, evidence: "CLI returned 42, exit 0" }] };
  assert.equal(enforceCoverage(covered, criteria, checks).verdict, "pass");
  assert.equal(enforceCoverage(covered, criteria, { ...checks, complete: false }).verdict, "partial");
  assert.equal(enforceCoverage(covered, criteria, { ...checks, results: [{ command: "make test", cwd: ".", purpose: "Tests", status: "failed", exitCode: 1, output: "Assertion failed" }] }).verdict, "fail");
  assert.equal(enforceCoverage({ ...covered, coverage: [...covered.coverage, ...covered.coverage] }, criteria, checks).verdict, "partial");
});

test("missing documents recover within two attempts without redoing work", async () => {
  let calls = 0;
  const doc = await completeDocument<{ done: boolean }>({}, async () => (++calls === 2 ? { structuredResponse: { done: true } } : {}));
  assert.deepEqual(doc, { done: true });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(completeDocument({}, async () => { calls++; return {}; }), /two submission attempts/);
  assert.equal(calls, 2);
});

test("a rate limit aborts document recovery immediately", async () => {
  let calls = 0;
  const error = Object.assign(new Error("Quota exhausted"), { status: 429 });
  await assert.rejects(completeDocument({}, async () => { calls++; throw error; }), (value) => value === error);
  assert.equal(calls, 1);
  assert.equal(isModelRateLimit(new Error("Wrapper", { cause: error })), true);
  assert.equal(isModelRateLimit("429 Rate limit exceeded: free-models-per-day-stealth"), true);
  assert.equal(isModelRateLimit(new Error("Invalid tool arguments")), false);
  const cyclic = { cause: null as unknown }; cyclic.cause = cyclic;
  assert.equal(isModelRateLimit(cyclic), false);
});
