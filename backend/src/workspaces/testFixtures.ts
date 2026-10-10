import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { storage } from "../db.js";
import { cloneWorkspace } from "../repositories/git.js";

// Trusted host fixtures seed the same bare cache used by production clones.
export async function createTestWorkspace(issueId: string, files: Record<string, string>) {
  const dir = dirname(storage), source = join(dir, "fixture-source"), bare = join(dir, "repo.git");
  const git = async (...args: string[]) => promisify(execFile)("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", ...args]);
  if (!existsSync(bare)) {
    await mkdir(source, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(source, name)), { recursive: true });
      await writeFile(join(source, name), content);
    }
    await git("init", "-q", "-b", "main", source);
    await git("-C", source, "add", "."); await git("-C", source, "commit", "-qm", "fixture");
    await git("clone", "--bare", "-q", source, bare);
    await git("-C", bare, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
    await git("-C", bare, "fetch", "-q", "origin");
    await git("-C", bare, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  }
  await cloneWorkspace(issueId, `test/${issueId}`);
}
