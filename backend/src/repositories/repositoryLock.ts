import { AsyncLocalStorage } from "node:async_hooks";

// Workspace creation and repository replacement must not overlap. Reentrant for
// operations (e.g. workspace cloning) already inside a repository change.
const held = new AsyncLocalStorage<{ active: boolean }>();
let tail: Promise<unknown> = Promise.resolve();
export function withRepositoryLock<T>(work: () => Promise<T>): Promise<T> {
  if (held.getStore()?.active) return work();
  const run = tail.then(() => {
    const scope = { active: true };
    return held.run(scope, async () => {
      try {
        return await work();
      } finally {
        scope.active = false;
      }
    });
  });
  tail = run.catch(() => {});
  return run;
}
