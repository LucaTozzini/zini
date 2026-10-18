import { withRepositoryLock } from "./repositoryLock.js";
import { withWorkspaceLock } from "../workspaces/workspaceLocks.js";

export class RepositoryChangeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type RepositoryChange = {
  current: () => Promise<string | null>;
  workspaces: () => Promise<string[]>;
  busy: (issueId: string) => boolean;
  clone: (repo: string, beforeReplace?: () => Promise<void>) => Promise<void>;
  remove: (issueId: string) => Promise<unknown>;
  save: () => Promise<void>;
};

export function changeRepository(repo: string, confirmed: boolean, deps: RepositoryChange) {
  return withRepositoryLock(async () => {
    const current = await deps.current();
    const changing = current?.toLowerCase() !== repo.toLowerCase();
    const ids = changing ? (await deps.workspaces()).sort() : [];
    if (ids.length && !confirmed)
      throw new RepositoryChangeError("Confirm workspace deletion before changing the repository", 409);
    // Hold every workspace lock until cleanup, clone replacement and settings save
    // finish. A queued Forge start then sees that its workspace no longer exists.
    const lock = (index: number): Promise<void> =>
      index < ids.length ? withWorkspaceLock(ids[index]!, () => lock(index + 1)) : replace();
    const replace = async () => {
      if (ids.some(deps.busy))
        throw new RepositoryChangeError("Pause running Forges and stop app launches before changing the repository", 409);
      await deps.clone(repo, async () => {
        for (const id of ids) await deps.remove(id);
      });
      await deps.save();
    };
    await lock(0);
  });
}
