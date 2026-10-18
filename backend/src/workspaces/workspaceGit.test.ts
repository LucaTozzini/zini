import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

test(
  "Git helper is reused and batched diffs include tracked, untracked and binary changes",
  {
    skip: process.env.ZINI_DOCKER_TESTS !== "1",
    timeout: 180000,
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "zini-git-"));
    process.env.DB_PATH = join(dir, "db.sqlite");
    const { createTestWorkspace } = await import("./testFixtures.js");
    const { workspaceDiffSnapshot, workspaceDiff, workspaceChanges } = await import("./workspaceFiles.js");
    const { workspaceGit, gitHelperName, sandboxName } = await import("./workspaceVolumes.js");
    const { docker } = await import("./docker.js");
    const { ensureSandbox, removeSandbox } = await import("./workspaceSandbox.js");
    const { runCommandResult } = await import("../forge/qaProcesses.js");
    const { removeWorkspaceMarker } = await import("../repositories/git.js");
    const { sequelize } = await import("../db.js");
    const id = `git-${randomUUID()}`;
    const inspect = async (name: string) => JSON.parse(await docker(["inspect", name]))[0];
    try {
      await createTestWorkspace(id, { "tracked.txt": "before\n", "deleted.txt": "remove\n", ".gitignore": "ignored.txt\n" });
      await ensureSandbox(id);
      assert.equal(
        (
          await runCommandResult(
            id,
            "printf 'after\\n' > tracked.txt; rm deleted.txt; mkdir nested; printf 'new\\n' > 'nested/new file.txt'; printf '\\000binary' > binary.dat; touch empty.txt; echo ignored > ignored.txt",
          )
        ).exitCode,
        0,
      );
      const start = performance.now();
      const snapshot = await workspaceDiffSnapshot(id);
      console.log(`Batched diff: ${Math.round(performance.now() - start)} ms`);
      assert.deepEqual(
        snapshot.changes.map((change) => change.path),
        ["binary.dat", "deleted.txt", "empty.txt", "nested/new file.txt", "tracked.txt"],
      );
      assert.equal(snapshot.changes.find((change) => change.path === "binary.dat")?.added, "-");
      assert.equal(snapshot.changes.find((change) => change.path === "empty.txt")?.added, "0");
      assert.match(snapshot.diff, /-before\n\+after/);
      assert.match(snapshot.diff, /\+new/);
      assert.match(snapshot.diff, /Binary files/);
      assert.equal((await inspect(sandboxName(id))).State.Paused, false);
      const helper = await inspect(gitHelperName(id));
      assert.deepEqual(await workspaceChanges(id), snapshot.changes);
      assert.deepEqual(await workspaceDiff(id), { diff: snapshot.diff, truncated: false });
      const pathDiff = await workspaceDiff(id, "nested");
      assert.match(pathDiff.diff, /new file.txt/);
      assert.doesNotMatch(pathDiff.diff, /tracked.txt|binary.dat/);
      await workspaceGit(id, ["add", "-A"]);
      await workspaceGit(id, ["commit", "-qm", "fixture edits"]);
      assert.equal((await workspaceDiffSnapshot(id, "", true)).diff, "");
      assert.match((await workspaceDiff(id)).diff, /\+after/);
      assert.equal((await inspect(gitHelperName(id))).Id, helper.Id);
      await docker(["stop", gitHelperName(id)]);
      assert.match(await workspaceGit(id, ["branch", "--show-current"]), /test\//);
      assert.equal((await inspect(gitHelperName(id))).Id, helper.Id);
      await assert.rejects(workspaceGit(id, ["rev-parse", "nonexistent-ref"]));
      assert.equal((await inspect(sandboxName(id))).State.Paused, false);
    } finally {
      await removeSandbox(id);
      await assert.rejects(docker(["inspect", gitHelperName(id)]));
      await removeWorkspaceMarker(id).catch(() => {});
      await sequelize.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
