import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test(
  "volume clones keep source off the host; trusted Git preserves staging and rejects executable config",
  { skip: process.env.ZINI_DOCKER_TESTS !== "1", timeout: 180000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "zini-git-test-"));
    process.env.DB_PATH = join(dir, "db.sqlite");
    const { workspacePath, git, removeWorkspaceMarker } = await import("./git.js");
    const { createTestWorkspace } = await import("../workspaces/testFixtures.js");
    const { ensureWorkspaceVolume } = await import("../workspaces/workspaceVolumes.js");
    const { runCommandResult } = await import("../forge/qaProcesses.js");
    const { removeSandbox, workspaceRequest } = await import("../workspaces/workspaceSandbox.js");
    const { sequelize } = await import("../db.js");
    const root = workspacePath("new");
    try {
      await assert.rejects(ensureWorkspaceVolume("missing"), /has not been initialized/);
      await createTestWorkspace("new", { "file.txt": "original\n", ".gitignore": "ignored\n" });
      assert.equal(await readFile(join(root, ".docker-volume"), "utf8"), "zini-workspace-new-files");
      await assert.rejects(access(join(root, ".git")), { code: "ENOENT" });
      assert.equal((await git(["-C", root, "branch", "--show-current"])).trim(), "test/new");
      const write = (path: string, content: string) =>
        workspaceRequest("new", "filesystem", { method: "write", args: [path, content] });
      await write("file.txt", "staged\n");
      await git(["-C", root, "add", "file.txt"]);
      const staged = await git(["-C", root, "diff", "--cached", "--binary"]);
      await write("file.txt", "staged\nunstaged\n");
      await write("untracked", "new data");
      await write("ignored", "dependencies/runtime data");
      assert.equal(await git(["-C", root, "diff", "--cached", "--binary"]), staged);
      assert.match(await git(["-C", root, "diff", "--binary"]), /unstaged/);
      assert.equal(
        await workspaceRequest("new", "file", { operation: "readText", path: "ignored" }),
        "dependencies/runtime data",
      );
      await runCommandResult("new", "git config filter.attack.clean 'echo unsafe'");
      await assert.rejects(git(["-C", root, "status", "--porcelain"]), /Unsafe workspace Git configuration/);
      await runCommandResult("new", "git config --remove-section filter.attack; printf /tmp > .git/objects/info/alternates");
      await assert.rejects(git(["-C", root, "status", "--porcelain"]), /external repositories/);
      await runCommandResult("new", "rm .git/objects/info/alternates");
      await removeSandbox("new");
      await removeWorkspaceMarker("new");
      await assert.rejects(access(root), { code: "ENOENT" });
    } finally {
      await removeSandbox("new");
      await sequelize.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
