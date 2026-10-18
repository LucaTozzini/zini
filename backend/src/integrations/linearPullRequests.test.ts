import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinearClient } from "@linear/sdk";

test("Linear PR discovery paginates, deduplicates and only accepts PR links in the configured repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zini-linear-prs-"));
  process.env.DB_PATH = join(dir, "db.sqlite");
  const { linkedPullRequests } = await import("./linear.js");
  const { sequelize } = await import("../db.js");
  const cursors: unknown[] = [];
  const client = {
    client: {
      rawRequest: async (_query: string, args: { after: string | null }) => {
        cursors.push(args.after);
        const urls = args.after
          ? ["https://github.com/OWNER/Repo/pull/20/", "https://github.com/owner/repo/pull/21"]
          : [
              "https://github.com/owner/repo/pull/20",
              "https://github.com/other/repo/pull/22",
              "https://github.com/owner/repo/issues/20",
              "not a URL",
            ];
        return {
          data: {
            issue: {
              attachments: { nodes: urls.map((url) => ({ url })), pageInfo: { hasNextPage: !args.after, endCursor: "next" } },
            },
          },
        };
      },
    },
  } as unknown as LinearClient;
  try {
    assert.deepEqual(await linkedPullRequests(client, "issue", "owner/repo"), [20, 21]);
    assert.deepEqual(cursors, [null, "next"]);
    const failure = {
      client: {
        rawRequest: async () => {
          throw new Error("Linear unavailable");
        },
      },
    } as unknown as LinearClient;
    await assert.rejects(linkedPullRequests(failure, "issue", "owner/repo"), /Linear unavailable/);
  } finally {
    await sequelize.close();
    await rm(dir, { recursive: true, force: true });
  }
});
