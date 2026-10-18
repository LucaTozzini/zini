import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

test(
  "sandbox commands can't wait on stdin, and quiet ones are stopped and returned",
  {
    skip: process.env.ZINI_DOCKER_TESTS !== "1",
    timeout: 240000,
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "zini-quiet-"));
    process.env.DB_PATH = join(dir, "db.sqlite");
    const { createTestWorkspace } = await import("../workspaces/testFixtures.js");
    const { removeSandbox } = await import("../workspaces/workspaceSandbox.js");
    const { runCommandResult } = await import("./qaProcesses.js");
    const { commandTools } = await import("./qaTools.js");
    const { sequelize } = await import("../db.js");
    const { removeWorkspaceMarker } = await import("../repositories/git.js");
    const id = `quiet-${randomUUID()}`;
    // Asks a question, then stays alive like a script holding a database connection.
    const prompt = "process.stdout.write('Proceed? (y/n): '); setInterval(() => {}, 1000);";
    try {
      await createTestWorkspace(id, { "prompt.cjs": prompt });

      // stdin is closed: a command reading it gets end-of-input at once.
      const cat = await runCommandResult(id, "cat", ".", 30);
      assert.equal(cat.exitCode, 0);

      const quiet = await runCommandResult(id, "node prompt.cjs", ".", 60, undefined, 3);
      assert.equal(quiet.exitCode, null);
      assert.match(quiet.status, /Stopped after 3 s without output: it may be waiting for input/);
      assert.match(quiet.output, /Proceed\? \(y\/n\): /);

      // Regular output keeps a slow command going.
      const steady = await runCommandResult(
        id,
        'node -e "let n = 0; const t = setInterval(() => { console.log(n); if (++n === 6) clearInterval(t); }, 1000)"',
        ".",
        60,
        undefined,
        3,
      );
      assert.equal(steady.exitCode, 0);

      // The agents' run_command passes quietSeconds through.
      const runTool = commandTools(id).find((entry) => entry.name === "run_command")!;
      assert.match(String(await runTool.invoke({ command: "node prompt.cjs", quietSeconds: 10 })), /without output/);
    } finally {
      await removeSandbox(id);
      await removeWorkspaceMarker(id);
      await sequelize.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
