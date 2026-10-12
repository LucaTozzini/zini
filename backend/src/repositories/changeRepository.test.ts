import assert from "node:assert/strict";
import test from "node:test";
import { changeRepository, RepositoryChangeError } from "./changeRepository.js";
import { withRepositoryLock } from "./repositoryLock.js";
import { withWorkspaceLock } from "../workspaces/workspaceLocks.js";

function fixture() {
  const steps: string[] = [];
  const deps = {
    current: async () => "owner/old",
    workspaces: async () => ["two", "one"],
    busy: (_id: string) => false,
    clone: async (_repo: string, beforeReplace?: () => Promise<void>) => {
      steps.push("validate clone");
      await beforeReplace?.();
      steps.push("replace clone");
    },
    remove: async (id: string) => { steps.push(`delete ${id}`); },
    save: async () => { steps.push("save settings"); },
  };
  return { deps, steps };
}

test("changing repositories requires explicit deletion confirmation", async () => {
  const { deps, steps } = fixture();
  await assert.rejects(changeRepository("owner/new", false, deps), (error) =>
    error instanceof RepositoryChangeError && error.status === 409);
  assert.deepEqual(steps, []);
});

test("validate first, delete every workspace, then replace and save", async () => {
  const { deps, steps } = fixture();
  await changeRepository("owner/new", true, deps);
  assert.deepEqual(steps, ["validate clone", "delete one", "delete two", "replace clone", "save settings"]);
});

test("an active Forge or launch blocks cleanup before deleting anything", async () => {
  const { deps, steps } = fixture();
  deps.busy = (id) => id === "two";
  await assert.rejects(changeRepository("owner/new", true, deps), /Pause running Forges/);
  assert.deepEqual(steps, []);
});

test("invalid clones leave all workspaces and the saved repository untouched", async () => {
  const { deps, steps } = fixture();
  deps.clone = async () => { throw new Error("no access"); };
  await assert.rejects(changeRepository("owner/new", true, deps), /no access/);
  assert.deepEqual(steps, []);
});

test("a cleanup failure prevents clone replacement and settings save", async () => {
  const { deps, steps } = fixture();
  deps.remove = async (id) => { steps.push(`delete ${id}`); if (id === "two") throw new Error("Docker unavailable"); };
  await assert.rejects(changeRepository("owner/new", true, deps), /Docker unavailable/);
  assert.deepEqual(steps, ["validate clone", "delete one", "delete two"]);
});

test("saving the same repo, case-insensitively, doesn't remove workspaces", async () => {
  const { deps, steps } = fixture();
  await changeRepository("OWNER/OLD", false, deps);
  assert.deepEqual(steps, ["validate clone", "replace clone", "save settings"]);
});

test("workspace creation and Forge starts wait until the switch completes", async () => {
  const { deps, steps } = fixture();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  deps.clone = async (_repo, beforeReplace) => {
    entered(); await held;
    await beforeReplace?.();
    steps.push("replace clone");
  };
  const switching = changeRepository("owner/new", true, deps);
  await started;
  const create = withRepositoryLock(async () => { steps.push("create new workspace"); });
  const start = withWorkspaceLock("one", async () => { steps.push("check workspace before Forge start"); });
  assert.equal(steps.length, 0);
  release();
  await Promise.all([switching, create, start]);
  assert.ok(steps.indexOf("create new workspace") > steps.indexOf("save settings"));
  assert.ok(steps.indexOf("check workspace before Forge start") > steps.indexOf("save settings"));
});
