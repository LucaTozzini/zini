import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("preview polling leaves paused gateways alone and explicit workspace access resumes them", {
  skip: process.env.ZINI_DOCKER_TESTS !== "1", timeout: 120000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-paused-gateway-"));
  process.env.DB_PATH = join(dir, "db.sqlite");
  const { createTestWorkspace } = await import("./testFixtures.js");
  const { ensureSandbox, existingSandbox, removeSandbox, docker, sandboxName } = await import("./workspaceSandbox.js");
  const { WorkspaceAppRuntime } = await import("./workspaceAppRuntime.js");
  const { removeWorkspaceMarker } = await import("../repositories/git.js");
  const { sequelize } = await import("../db.js");
  const id = randomUUID();
  try {
    await createTestWorkspace(id, { "README.md": "Paused gateway fixture\n" });
    const initial = await ensureSandbox(id);
    await docker(["pause", sandboxName(id)]);
    assert.equal(await existingSandbox(id), null);
    const runtime = new WorkspaceAppRuntime();
    assert.equal((await runtime.refresh(id)).status, "stopped");
    assert.equal((await runtime.refresh(id)).status, "stopped");
    assert.equal((await docker(["inspect", "--format", "{{.State.Paused}}", sandboxName(id)])).trim(), "true");
    const resumed = await ensureSandbox(id);
    assert.equal(resumed.generation, initial.generation, "Unpausing preserves the container and its processes");
    assert.equal((await docker(["inspect", "--format", "{{.State.Paused}}", sandboxName(id)])).trim(), "false");
    assert.equal((await runtime.refresh(id)).status, "stopped");
  } finally {
    await docker(["unpause", sandboxName(id)]).catch(() => {});
    await removeSandbox(id);
    await removeWorkspaceMarker(id).catch(() => {});
    await sequelize.close();
    await rm(dir, { recursive: true, force: true });
  }
});
