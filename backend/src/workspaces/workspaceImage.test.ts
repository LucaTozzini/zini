import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

test(
  "workspace containers from an older image build are recreated, keeping their files",
  {
    skip: process.env.ZINI_DOCKER_TESTS !== "1",
    timeout: 300000,
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "zini-image-"));
    process.env.DB_PATH = join(dir, "db.sqlite");
    const { createTestWorkspace } = await import("./testFixtures.js");
    const { ensureSandbox, removeSandbox, docker, sandboxImage, sandboxName } = await import("./workspaceSandbox.js");
    const { forgetImageChecks } = await import("./workspaceVolumes.js");
    const { workspaceChanges } = await import("./workspaceFiles.js");
    const { runCommandResult } = await import("../forge/qaProcesses.js");
    const { sequelize } = await import("../db.js");
    const { removeWorkspaceMarker } = await import("../repositories/git.js");
    const id = `image-${randomUUID()}`;
    const containerId = async (name: string) => (await docker(["inspect", "--format", "{{.Id}}", name])).trim();
    const original = (await docker(["image", "inspect", "--format", "{{.Id}}", sandboxImage])).trim();
    const base = `zini-workspace:test-${randomUUID()}`;
    let rebuilt = "";
    try {
      await createTestWorkspace(id, { "kept.txt": "kept\n" });
      await ensureSandbox(id);
      assert.equal((await runCommandResult(id, "echo state > /state/kept && echo edit >> kept.txt")).exitCode, 0);
      await workspaceChanges(id); // Starts the workspace's Git helper.
      const before = { sandbox: await containerId(sandboxName(id)), git: await containerId(`${sandboxName(id)}-git`) };

      // A new build of the image: the same content with a label, tagged in its place.
      // Builds can't start from a bare image ID, so the original gets a temporary tag.
      await docker(["tag", original, base]);
      await mkdir(join(dir, "rebuild"));
      await writeFile(join(dir, "rebuild", "Dockerfile"), `FROM ${base}\nLABEL zini.test=rebuild\n`);
      rebuilt = (await docker(["build", "--quiet", "-t", sandboxImage, join(dir, "rebuild")])).trim();
      assert.notEqual(rebuilt, original);
      forgetImageChecks(); // As buildSandboxImage does.

      await ensureSandbox(id);
      assert.equal((await runCommandResult(id, "cat /state/kept kept.txt")).output.trim(), "state\nkept\nedit");
      assert.deepEqual(
        (await workspaceChanges(id)).map((change) => change.path),
        ["kept.txt"],
      );
      const after = { sandbox: await containerId(sandboxName(id)), git: await containerId(`${sandboxName(id)}-git`) };
      assert.notEqual(after.sandbox, before.sandbox, "the workspace container is recreated from the new build");
      assert.notEqual(after.git, before.git, "the Git helper is recreated from the new build");

      // Checked once per backend process: later requests reuse the new containers.
      await ensureSandbox(id);
      assert.equal(await containerId(sandboxName(id)), after.sandbox);
    } finally {
      await docker(["tag", original, sandboxImage]);
      await docker(["rmi", base]).catch(() => {});
      await removeSandbox(id);
      await removeWorkspaceMarker(id);
      await docker(["rm", "-f", `${sandboxName(id)}-git`]).catch(() => {});
      if (rebuilt && rebuilt !== original) await docker(["rmi", rebuilt]).catch(() => {});
      await sequelize.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
