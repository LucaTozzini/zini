import { mkdtemp, chmod, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Only the backend refreshes OAuth. Containers read this file on every model request.
// Mount the directory, so atomic replacements remain visible inside Docker.
export async function createEvalCredentials(token: () => Promise<string>, onError: (error: unknown) => void,
  intervalMs = 30_000) {
  const directory = await mkdtemp(join(tmpdir(), "zini-eval-auth-"));
  let updating: Promise<void> | null = null;
  const update = async () => {
    const value = await token();
    await writeFile(join(directory, "next-token"), value, { mode: 0o600 });
    // Windows can briefly deny replacement while a reader has the token open.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(join(directory, "next-token"), join(directory, "access-token"));
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 9 || (code !== "EPERM" && code !== "EBUSY")) throw error;
        await delay(10 * (attempt + 1));
      }
    }
  };
  try {
    await chmod(directory, 0o700);
    await update();
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const timer = setInterval(() => {
    if (!updating) updating = update().catch(onError).finally(() => { updating = null; });
  }, intervalMs);
  return {
    directory,
    async close() {
      clearInterval(timer);
      await updating;
      await rm(directory, { recursive: true, force: true });
    },
  };
}
