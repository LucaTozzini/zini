import type { IntegrationState, WorkspaceContext } from "shared";
import { fetchRepo, git, workspacePath } from "../repositories/git.js";
import { commitRound, conflictDetails, integrateBranch, mergeHead, unresolvedFiles } from "../repositories/integration.js";
import { Workspace } from "../models/Workspace.js";
import { withWorkspaceLock } from "./workspaceLocks.js";
import { trustedGit } from "./trustedGit.js";
import { refreshWorkspaceRefs } from "./workspaceVolumes.js";
import { sendEvent } from "../core/events.js";

const runner = (id: string) => (args: string[]) => git(["-C", workspacePath(id), ...args]);
const locked = <T>(id: string, work: () => Promise<T>) => withWorkspaceLock(id, () => trustedGit(workspacePath(id), work));
export async function workspaceContext(id: string): Promise<WorkspaceContext> {
  const row = await Workspace.findByPk(id);
  if (!row) throw new Error("This issue has no workspace");
  if (!row.context) throw new Error("Workspace starting context is missing");
  return row.context;
}
// Commits everything not committed yet (completing a merge once its conflicts are
// resolved), then merges in the latest target branch. committed: a commit was made.
// The integration says whether the merge happened, wasn't needed, or stopped on
// conflicts, which stay in the workspace to resolve.
export async function commitAndIntegrate(
  id: string,
  message: string,
  refresh: () => Promise<void> = fetchRepo,
): Promise<{ committed: boolean; integration: IntegrationState }> {
  const context = await workspaceContext(id);
  return locked(id, async () => {
    const run = runner(id);
    const committed = await commitRound(run, message);
    await refresh();
    await refreshWorkspaceRefs(id);
    const integration = await integrateBranch(run, context.targetBranch);
    sendEvent({ type: "workspace.updated", issueId: id });
    return { committed, integration };
  });
}

// Whether everything is committed and the branch has the latest target branch (fetched
// first) merged in.
export async function isUpToDate(id: string, refresh: () => Promise<void> = fetchRepo) {
  const context = await workspaceContext(id);
  return locked(id, async () => {
    const run = runner(id);
    if ((await mergeHead(run)) || (await run(["status", "--porcelain"])).trim()) return false;
    await refresh();
    await refreshWorkspaceRefs(id);
    const target = (await run(["rev-parse", `refs/remotes/origin/${context.targetBranch}`])).trim();
    return run(["merge-base", "--is-ancestor", target, "HEAD"]).then(
      () => true,
      (error) => {
        if ((error as { code?: number }).code === 1) return false;
        throw error;
      },
    );
  });
}
export const inspectConflicts = (id: string, path?: string) =>
  locked(id, async () =>
    path ? conflictDetails(runner(id), path) : (await unresolvedFiles(runner(id))).map((path) => ({ path })),
  );
export async function assertNoMerge(id: string) {
  const run = runner(id);
  if ((await mergeHead(run)) || (await unresolvedFiles(run)).length)
    throw new Error("Resolve and complete the pending merge through Forge first");
}

// Agents resolve files through normal tools; this controlled operation records
// resolutions (including deletions), without giving them Git metadata access.
export async function resolveConflict(id: string, path: string) {
  return locked(id, async () => {
    const run = runner(id);
    if (!(await unresolvedFiles(run)).includes(path)) throw new Error("This file is not an unresolved conflict");
    const diff = await run(["diff", "--check", "--", path]).catch((error) => {
      throw new Error(`Remove conflict markers before resolving: ${String(error)}`);
    });
    await run(["add", "-A", "--", path]);
    return diff || `Recorded resolution for ${path}`;
  });
}
