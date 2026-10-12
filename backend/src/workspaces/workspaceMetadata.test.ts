import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import type { Workspace as WorkspaceResponse } from "shared";

test("workspace metadata loads while its execution lock is held, without a Docker workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-workspace-metadata-"));
  process.env.DB_PATH = join(dir, "db.sqlite");
  const { workspaces } = await import("../routes/workspaces.js");
  const { Workspace } = await import("../models/Workspace.js");
  const { initDb, sequelize } = await import("../db.js");
  const { checkpointer } = await import("../agents/agents.js");
  const { withWorkspaceLock } = await import("./workspaceLocks.js");
  await initDb();
  const id = randomUUID();
  await Workspace.create({ issueId: id, context: {
    branch: "feature/existing-pr", initialHead: "abc", targetBranch: "main", sourcePr: null,
  } });
  const app = express(); app.use("/workspaces", workspaces);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const held = withWorkspaceLock(id, () => new Promise<void>(resolve => { release = resolve; entered(); }));
  await ready;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/workspaces/${id}`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    const workspace = await response.json() as WorkspaceResponse;
    assert.equal(workspace.branch, "feature/existing-pr");
    assert.equal(workspace.issueId, id);
    assert.equal(workspace.forgeRunning, false);
    assert.ok(workspace.path.startsWith("docker-volume:"));
    assert.ok(!("uncommitted" in workspace));
    assert.ok(!("unpushed" in workspace));
    const missing = await fetch(`http://127.0.0.1:${address.port}/workspaces/${randomUUID()}`);
    assert.equal(await missing.json(), null);
  } finally {
    release(); await held;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    checkpointer.db.close(); await sequelize.close();
    await rm(dir, { recursive: true, force: true });
  }
});
