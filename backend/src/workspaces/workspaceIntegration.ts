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
export async function prepareIntegration(id: string, refresh: () => Promise<void> = fetchRepo): Promise<IntegrationState> {
  const context = await workspaceContext(id);
  // Recover a pending merge before fetching another upstream revision.
  return locked(id, async () => {
    const run = runner(id);
    if (!await mergeHead(run)) { await refresh(); await refreshWorkspaceRefs(id); }
    const result = await integrateBranch(run, context.targetBranch);
    sendEvent({ type: "workspace.updated", issueId: id });
    return result;
  });
}
export async function commitCoderRound(id: string, message: string) {
  return locked(id, async () => {
    const committed = await commitRound(runner(id), message);
    sendEvent({ type: "workspace.updated", issueId: id });
    return committed;
  });
}
export const inspectConflicts = (id: string, path?: string) => locked(id, async () => path
  ? conflictDetails(runner(id), path)
  : (await unresolvedFiles(runner(id))).map(path => ({ path })));
export async function assertNoMerge(id: string) {
  const run = runner(id);
  if (await mergeHead(run) || (await unresolvedFiles(run)).length) throw new Error("Resolve and complete the pending merge through Forge first");
}

// Agents resolve files through normal tools; this controlled operation records
// resolutions (including deletions), without giving them Git metadata access.
export async function resolveConflict(id: string, path: string) {
  return locked(id, async () => {
    const run = runner(id);
    if (!(await unresolvedFiles(run)).includes(path)) throw new Error("This file is not an unresolved conflict");
    const diff = await run(["diff", "--check", "--", path]).catch(error => { throw new Error(`Remove conflict markers before resolving: ${String(error)}`); });
    await run(["add", "-A", "--", path]);
    return diff || `Recorded resolution for ${path}`;
  });
}
