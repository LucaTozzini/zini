import { AsyncLocalStorage } from "node:async_hooks";

// Git mutations and container lifecycle operations share a lock per workspace.
const queues = new Map<string, Promise<unknown>>();
const held = new AsyncLocalStorage<ReadonlySet<string>>();
export function withWorkspaceLock<T>(issueId: string, work: () => Promise<T>): Promise<T> {
  if (held.getStore()?.has(issueId)) return work();
  const previous = queues.get(issueId) ?? Promise.resolve();
  const execute = () => held.run(new Set([...(held.getStore() ?? []), issueId]), work);
  const run = previous.then(execute, execute);
  const tail = run.catch(() => {}).finally(() => { if (queues.get(issueId) === tail) queues.delete(issueId); });
  queues.set(issueId, tail); return run;
}
