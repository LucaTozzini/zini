import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitRound, conflictDetails, integrateBranch, mergeHead, unresolvedFiles } from "./integration.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "zini-integration-"));
  const run = async (args: string[]) =>
    (
      await promisify(execFile)("git", [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@zini.local",
        "-c",
        "core.autocrlf=false",
        "-C",
        dir,
        ...args,
      ])
    ).stdout;
  const write = (name: string, content: string) => writeFile(join(dir, name), content);
  await run(["init", "-q", "-b", "main"]);
  await write("file.txt", "baseline\n");
  await commitRound(run, "baseline");
  await run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await run(["checkout", "-q", "-b", "issue"]);
  return { dir, run, write, close: () => rm(dir, { recursive: true, force: true }) };
}

test("completed coder rounds commit once, then a clean integration preserves both histories", async () => {
  const f = await fixture();
  try {
    assert.equal((await integrateBranch(f.run, "main")).status, "current");
    await f.write("feature.txt", "implementation\n");
    assert.equal((await integrateBranch(f.run, "main")).status, "deferred");
    assert.equal(await commitRound(f.run, "Implement feature"), true);
    assert.equal(await commitRound(f.run, "Implement feature"), false);
    const implementation = (await f.run(["rev-parse", "HEAD"])).trim();
    await f.run(["checkout", "-q", "main"]);
    await f.write("upstream.txt", "upstream behavior\n");
    await commitRound(f.run, "Upstream change");
    await f.run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const upstream = (await f.run(["rev-parse", "HEAD"])).trim();
    await f.run(["checkout", "-q", "issue"]);
    assert.equal((await integrateBranch(f.run, "main")).status, "merged");
    await f.run(["merge-base", "--is-ancestor", implementation, "HEAD"]);
    await f.run(["merge-base", "--is-ancestor", upstream, "HEAD"]);
    assert.equal((await integrateBranch(f.run, "main")).status, "current");
    assert.equal((await f.run(["status", "--porcelain"])).trim(), "");
  } finally {
    await f.close();
  }
});

test("conflicts expose both implementations, survive re-entry, and cannot be committed unresolved", async () => {
  const f = await fixture();
  try {
    await f.write("file.txt", "issue behavior\n");
    await commitRound(f.run, "Issue implementation");
    await f.run(["checkout", "-q", "main"]);
    await f.write("file.txt", "upstream behavior\n");
    await commitRound(f.run, "Upstream implementation");
    await f.run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await f.run(["checkout", "-q", "issue"]);
    const merge = await integrateBranch(f.run, "main");
    assert.equal(merge.status, "conflicts");
    assert.deepEqual(merge.conflicts, ["file.txt"]);
    assert.deepEqual(await integrateBranch(f.run, "main"), merge);
    const [details] = await conflictDetails(f.run, "file.txt");
    assert.equal((details!.ours as { content: string }).content, "issue behavior\n");
    assert.equal((details!.theirs as { content: string }).content, "upstream behavior\n");
    await assert.rejects(commitRound(f.run, "Resolve conflict"), /Resolve all conflicts/);
    await f.write("file.txt", "issue behavior\nupstream behavior\n");
    await f.run(["add", "file.txt"]);
    assert.deepEqual(await unresolvedFiles(f.run), []);
    assert.ok(await mergeHead(f.run));
    await commitRound(f.run, "Preserve issue and upstream behavior");
    assert.equal(await mergeHead(f.run), null);
    assert.equal((await integrateBranch(f.run, "main")).status, "current");
    assert.equal((await f.run(["rev-list", "--parents", "-n", "1", "HEAD"])).trim().split(" ").length, 3);
  } finally {
    await f.close();
  }
});

test("delete/modify conflicts expose deleted sides and operational failures are not conflicts", async () => {
  const f = await fixture();
  try {
    await f.run(["rm", "file.txt"]);
    await commitRound(f.run, "Delete legacy file");
    await f.run(["checkout", "-q", "main"]);
    await f.write("file.txt", "upstream\n");
    await commitRound(f.run, "Update legacy file");
    await f.run(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await f.run(["checkout", "-q", "issue"]);
    await integrateBranch(f.run, "main");
    const [details] = await conflictDetails(f.run, "file.txt");
    assert.deepEqual(details!.ours, { deleted: true });
    await assert.rejects(conflictDetails(f.run, "../file.txt"), /Choose a path/);
    await f.run(["merge", "--abort"]);
    await assert.rejects(integrateBranch(f.run, "missing"));
  } finally {
    await f.close();
  }
});
