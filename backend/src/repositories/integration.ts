import type { IntegrationState } from "shared";

export type GitRunner = (args: string[]) => Promise<string>;
export async function unresolvedFiles(run: GitRunner) {
  return [...new Set((await run(["diff", "--name-only", "--diff-filter=U", "-z"])).split("\0").filter(Boolean))];
}
export async function mergeHead(run: GitRunner) {
  try {
    return (await run(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"])).trim();
  } catch (error) {
    if ((error as { code?: number }).code === 1) return null;
    throw error;
  }
}
export async function integrateBranch(run: GitRunner, targetBranch: string): Promise<IntegrationState> {
  const pending = await mergeHead(run);
  if (pending) return { targetBranch, targetCommit: pending, status: "conflicts", conflicts: await unresolvedFiles(run) };
  const targetCommit = (await run(["rev-parse", `refs/remotes/origin/${targetBranch}`])).trim();
  if ((await run(["status", "--porcelain"])).trim()) return { targetBranch, targetCommit, status: "deferred", conflicts: [] };
  const state = { targetBranch, targetCommit, conflicts: [] as string[] };
  try {
    await run(["merge-base", "--is-ancestor", targetCommit, "HEAD"]);
    return { ...state, status: "current" };
  } catch (error) {
    if ((error as { code?: number }).code !== 1) throw error;
  }
  try {
    await run(["merge", "--no-edit", targetCommit]);
  } catch (error) {
    if (!(await mergeHead(run))) throw error;
    return { ...state, status: "conflicts", conflicts: await unresolvedFiles(run) };
  }
  return { ...state, status: "merged" };
}

export async function commitRound(run: GitRunner, message: string) {
  const pending = await mergeHead(run);
  const conflicts = await unresolvedFiles(run);
  if (conflicts.length) throw new Error(`Resolve all conflicts before committing: ${conflicts.join(", ")}`);
  if (!pending && !(await run(["status", "--porcelain"])).trim()) return false;
  if (!message.trim()) throw new Error("Coder must provide a commit message for its changes");
  await run(["add", "-A"]);
  await run(["commit", "--quiet", "-m", message.trim()]);
  return true;
}

// Contents are bounded and paired with object IDs; deleted sides are explicit.
export async function conflictDetails(run: GitRunner, path?: string) {
  const files = await unresolvedFiles(run);
  if (path && !files.includes(path)) throw new Error("Choose a path from the unresolved conflict list");
  const records = (await run(["ls-files", "-u", "-z"])).split("\0").filter(Boolean);
  const result: ({ path: string } & Record<string, unknown>)[] = [];
  for (const file of path ? [path] : files) {
    const sides: Record<string, unknown> = {};
    for (const [stage, name] of [
      ["1", "base"],
      ["2", "ours"],
      ["3", "theirs"],
    ]) {
      const record = records.find(
        (record) => record.slice(record.indexOf("\t") + 1) === file && record.split("\t")[0]!.endsWith(` ${stage}`),
      );
      if (!record) {
        sides[name!] = { deleted: true };
        continue;
      }
      const [mode, object] = record.split(" ");
      const content = await run(["cat-file", "blob", object!]);
      sides[name!] = {
        mode,
        object,
        binary: content.includes("\0"),
        content: content.includes("\0") ? undefined : content.slice(0, 12000),
        truncated: content.length > 12000,
      };
    }
    result.push({ path: file, ...sides });
  }
  return result;
}
