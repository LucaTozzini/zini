import test from "node:test";
import assert from "node:assert/strict";
import { SetupEvidence } from "./setupTools.js";
import type { RepoCommand } from "shared";
import { validateEnvironment } from "../workspaces/workspaceServices.js";
const approved = { requiredChanges: [], blockingQuestions: [] };
const seed: RepoCommand = { id: "seed", kind: "setup", command: "npm run seed", cwd: ".", purpose: "Seed test data", sources: ["package.json"] };
test("preparation results come from tools and failed seeds can recover", () => {
  const evidence = new SetupEvidence(null, "rev");
  evidence.record({ ...seed, status: "blocked", exitCode: 1, output: "relation missing" });
  assert.equal(evidence.report({ ...approved, blockingQuestions: ["Missing schema"] }).complete, false);
  evidence.record({ ...seed, status: "passed", exitCode: 0, output: "seeded" });
  const report = evidence.report(approved);
  assert.equal(report.complete, true); assert.equal(report.results.length, 1);
  assert.equal(new SetupEvidence(report, "rev").results.length, 1);
  assert.equal(new SetupEvidence(report, "changed").results.length, 0);
});

test("startup failures remain blockers until a successful probe is recorded", () => {
  const evidence = new SetupEvidence(null, "rev");
  const probe = { command: "Readiness: app", cwd: ".", purpose: "probe", status: "blocked" as const, exitCode: 1, output: "missing env" };
  evidence.record(probe);
  assert.equal(evidence.report({ ...approved, blockingQuestions: ["Missing env"] }).complete, false);
  evidence.record({ ...probe, status: "passed", exitCode: 0, output: "200" });
  assert.equal(evidence.report(approved).complete, true);
  assert.equal(evidence.report({ ...approved, blockingQuestions: ["Missing provider credential"] }).complete, false);
});
test("failed commands do not end setup early; the operation budget still bounds retries", () => {
  const evidence = new SetupEvidence(null, "rev");
  for (let i = 0; i < 32; i++) {
    evidence.budget();
    evidence.record({ ...seed, status: "blocked", exitCode: 1, output: "failed" });
  }
  assert.throws(() => evidence.budget(), /budget exhausted/);
  for (const key of ["PATH", "NODE_OPTIONS", "WORKSPACE_TOKEN", "GIT_CONFIG_COUNT", "LD_PRELOAD"]) assert.throws(() => validateEnvironment({ [key]: "value" }), /Reserved/);
  validateEnvironment({ DATABASE_URL: "local", NODE_ENV: "test" });
});
