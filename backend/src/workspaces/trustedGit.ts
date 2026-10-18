import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
const exec = promisify(execFile);
const containers = new Map<string, string>();
const queues = new Map<string, Promise<unknown>>();
const frozen = new AsyncLocalStorage<string>();
export function registerGitSandbox(path: string, name: string) {
  containers.set(path, name);
}
export function forgetGitSandbox(path: string) {
  containers.delete(path);
}
// Validation and Git must see the same metadata. Freeze sandbox processes while
// trusted Git reads/mutates it so a command cannot swap config after validation.
export function trustedGit<T>(path: string, work: () => Promise<T>): Promise<T> {
  if (frozen.getStore() === path) return work();
  const previous = queues.get(path) ?? Promise.resolve();
  const run = previous.then(async () => {
    const name = containers.get(path);
    if (name) {
      // Recover an orphaned pause left by a backend crash during a Git operation.
      const { stdout } = await exec("docker", ["inspect", "--format", "{{.State.Paused}}", name], {
        windowsHide: true,
        timeout: 15000,
      });
      if (stdout.trim() !== "true") await exec("docker", ["pause", name], { windowsHide: true, timeout: 15000 });
    }
    try {
      return await frozen.run(path, work);
    } finally {
      if (name && containers.get(path) === name) await exec("docker", ["unpause", name], { windowsHide: true, timeout: 15000 });
    }
  });
  const tail = run
    .catch(() => {})
    .finally(() => {
      if (queues.get(path) === tail) queues.delete(path);
    });
  queues.set(path, tail);
  return run;
}
