import test from "node:test";
import assert from "node:assert/strict";
import type { ChecksDocument, RepoCommand } from "shared";
import { enforceCoverage, freshRunbook, runbookText, updateRunbook } from "./validation.js";
import { REPO_COMMAND } from "./documents.js";
import { isModelRateLimit } from "../modelErrors.js";

test("runbook preserves commands for different packages and invalidates edited sources", async () => {
  const files = new Map([["Makefile", "a"], ["python/pyproject.toml", "b"]]);
  const fingerprint = async (path: string) => files.get(path) ?? null;
  const commands: RepoCommand[] = [
    { id: "build", command: "make build", cwd: ".", kind: "check", purpose: "Build", sources: ["Makefile"] },
    { id: "test", command: "uv run pytest", cwd: "python", kind: "check", purpose: "Python tests", sources: ["python/pyproject.toml"] },
  ];
  const book = await updateRunbook({}, commands, fingerprint);
  assert.equal(book.test?.cwd, "python");
  files.set("Makefile", "changed");
  const partialBook = await freshRunbook(book, fingerprint);
  assert.deepEqual(Object.keys(partialBook), ["test"]);
  assert.equal(Object.keys(await updateRunbook(book, [{ ...commands[0]!, sources: ["missing"] }], fingerprint)).length, 1);
});

test("startup handoffs retain operational details and survive unrelated source edits", async () => {
  const files = new Map([["service/Makefile", "recipe"], ["service/main.py", "implementation"], ["README.md", "docs"]]);
  const fingerprint = async (path: string) => files.get(path) ?? null;
  const purpose = "Start the service with the installed Python runtime from service/. " +
    "Requires the local fixture database from the completed setup. PORT selects the " +
    "listen port and DATA_DIR selects isolated test data; use a uniquely created " +
    "temporary directory. Wait for the 'Ready' output and use the printed local URL " +
    "to access the product; use its public API for acceptance checks.";
  const command = REPO_COMMAND.parse({ id: "start", kind: "start", command: "make serve", cwd: "service",
    purpose, sources: ["service/Makefile"] });
  const book = await updateRunbook({}, [command], fingerprint);
  files.set("README.md", "changed docs");
  files.set("service/main.py", "changed implementation");
  const current = await freshRunbook(book, fingerprint);
  assert.equal(current.start?.purpose, purpose);
  assert.ok(runbookText(current).includes(purpose));
  assert.ok(runbookText(current).includes("cwd: service"));
  files.set("service/Makefile", "changed recipe");
  assert.deepEqual(await freshRunbook(current, fingerprint), {});
});

const report = { failures: [], blockingQuestions: [], coverage: [] };
const checks: ChecksDocument = { revision: "v1", complete: true, results: [] };
const criteria = [{ id: "c1", requirement: "CLI returns the result", source: "Returns the result" }];
test("a pass needs current, complete checks and evidence for every criterion", () => {
  assert.equal(enforceCoverage(report, criteria, checks, "v1").verdict, "partial");
  const covered = { ...report, coverage: [{ criterionId: "c1", status: "pass" as const, evidence: "CLI returned 42, exit 0" }] };
  assert.equal(enforceCoverage(covered, criteria, checks, "v1").verdict, "pass");
  assert.equal(enforceCoverage(covered, criteria, checks, "v2").verdict, "partial");
  assert.equal(enforceCoverage(covered, criteria, { ...checks, complete: false }, "v1").verdict, "partial");
  assert.equal(enforceCoverage(covered, criteria, { ...checks, results: [{ command: "make test", cwd: ".", purpose: "Tests", status: "failed", exitCode: 1, output: "Assertion failed" }] }, "v1").verdict, "fail");
  assert.equal(enforceCoverage({ ...covered, failures: ["Crashes on empty input"] }, criteria, checks, "v1").verdict, "fail");
  const blocked = { ...report, coverage: [{ criterionId: "c1", status: "blocked" as const, evidence: "Needs a .env" }] };
  assert.deepEqual(enforceCoverage(blocked, criteria, checks, "v1").couldNotTest, ["c1: Needs a .env"]);
  assert.equal(enforceCoverage({ ...covered, coverage: [...covered.coverage, ...covered.coverage] }, criteria, checks, "v1").verdict, "partial");
});

test("rate limits are recognised through wrappers and messages", () => {
  const error = Object.assign(new Error("Quota exhausted"), { status: 429 });
  assert.equal(isModelRateLimit(error), true);
  assert.equal(isModelRateLimit(new Error("Wrapper", { cause: error })), true);
  assert.equal(isModelRateLimit("429 Rate limit exceeded: free-models-per-day-stealth"), true);
  assert.equal(isModelRateLimit(new Error("Invalid tool arguments")), false);
  const cyclic = { cause: null as unknown }; cyclic.cause = cyclic;
  assert.equal(isModelRateLimit(cyclic), false);
});
