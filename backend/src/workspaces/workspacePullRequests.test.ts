import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient } from "@linear/sdk";
import type { Workspace, WorkspaceGitStatus } from "shared";

test("PR creation rejects unfinished work and uses the workspace branch and configured base", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zini-pr-test-"));
  process.env.DB_PATH = join(dir, "db.sqlite");
  const { openWorkspacePullRequest: open } = await import("./workspacePullRequests.js");
  type Dependencies = NonNullable<Parameters<typeof open>[3]>;
  let workspace: Workspace & WorkspaceGitStatus = {
    issueId: "issue",
    branch: "feature/email",
    path: "docker-volume:fixture/repo",
    createdAt: "",
    forgeRunning: false,
    uncommitted: false,
    unpushed: false,
  };
  let pushed = true,
    running = false;
  const calls: Parameters<Dependencies["create"]>[] = [];
  const deps: Dependencies = {
    starting: () => false,
    running: () => running,
    workspace: async () => workspace,
    pushed: async () => pushed,
    github: async () => ({ token: "fixture-token", repo: "owner/product" }),
    linear: async () => ({}) as LinearClient,
    issue: async () => ({ identifier: "PW-20" }) as Awaited<ReturnType<Dependencies["issue"]>>,
    base: async () => "main",
    create: async (...args) => {
      calls.push(args);
      return { number: 20, url: "https://github.com/owner/product/pull/20", state: "open" };
    },
  };
  try {
    await t.test(
      "uncommitted, unpushed and unpublished changes return commit_and_push guidance without creating a PR",
      async () => {
        for (const state of [
          { uncommitted: true, unpushed: false, pushed: true },
          { uncommitted: false, unpushed: true, pushed: true },
          { uncommitted: false, unpushed: false, pushed: false },
        ]) {
          workspace = { ...workspace, uncommitted: state.uncommitted, unpushed: state.unpushed };
          pushed = state.pushed;
          const result = await open("issue", "Copy email", "", deps);
          assert.ok("error" in result);
          assert.equal(result.status, 409);
          assert.match(result.error, /commit_and_push/);
        }
        assert.equal(calls.length, 0);
      },
    );
    await t.test("active Forges block publication", async () => {
      running = true;
      const result = await open("issue", "Copy email", "", deps);
      assert.ok("error" in result);
      assert.match(result.error, /Forge is still working/);
      assert.equal(calls.length, 0);
      running = false;
    });
    await t.test("a clean pushed workspace opens a PR with normalized content and returns its link", async () => {
      workspace = { ...workspace, uncommitted: false, unpushed: false };
      pushed = true;
      const result = await open("issue", "  Copy email  ", "  Adds clipboard support.\n\nTests passed.  ", deps);
      assert.ok("pullRequest" in result);
      assert.equal(result.pullRequest.url, "https://github.com/owner/product/pull/20");
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], [
        "fixture-token",
        "owner/product",
        { title: "PW-20: Copy email", body: "Adds clipboard support.\n\nTests passed.", branch: "feature/email", base: "main" },
      ]);
    });
  } finally {
    const { checkpointer } = await import("../agents/agents.js");
    checkpointer.db.close();
    const { sequelize } = await import("../db.js");
    await sequelize.close();
    await rm(dir, { recursive: true, force: true });
  }
});
