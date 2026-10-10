import { lstat, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function validateGit(root: string) {
  const metadata = join(root, ".git");
  if (!(await stat(metadata)).isDirectory() || await realpath(metadata) !== join(await realpath(root), ".git")) throw new Error("Workspace requires an independent .git directory");
  async function links(folder: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if ((await lstat(file)).isSymbolicLink()) throw new Error("Workspace Git metadata cannot contain symlinks");
      if (entry.isDirectory()) await links(file);
    }
  }
  await links(metadata);
  for (const file of ["commondir", "objects/info/alternates", "objects/info/http-alternates"]) if (existsSync(join(metadata, file))) throw new Error("Workspace Git metadata cannot reference external repositories");
  const allowed: Record<string, string[]> = { core: ["repositoryformatversion", "filemode", "bare", "logallrefupdates", "symlinks", "ignorecase"], user: ["name", "email"], remote: ["url", "fetch"], branch: ["remote", "merge"] };
  let section = "";
  for (const raw of (await readFile(join(metadata, "config"), "utf8")).split(/\r?\n/)) {
    const line = raw.trim(); if (!line || /^[#;]/.test(line)) continue;
    if (line.startsWith("[")) {
      const match = /^\[(core|user|remote|branch)(?:\s+"[^"\r\n]+")?\]$/i.exec(line);
      if (!match) throw new Error("Unsafe workspace Git configuration section");
      section = match[1]!.toLowerCase();
    } else {
      const key = /^([\w]+)\s*=/.exec(line)?.[1]?.toLowerCase();
      if (!key || !allowed[section]?.includes(key)) throw new Error("Unsafe workspace Git configuration key");
    }
  }
}

export async function executeGit(root: string, args: string[], token?: string, localSource = false) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: "/tmp", LANG: "C.UTF-8", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CEILING_DIRECTORIES: root, GIT_HTTP_LOW_SPEED_LIMIT: "1000", GIT_HTTP_LOW_SPEED_TIME: "30" };
  if (token) Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader", GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` });
  if (localSource) {
    // Git's local transport strips command-scoped configuration. Its ownership
    // exception must live in a helper-owned config outside the mounted repository.
    await writeFile("/tmp/zini-gitconfig", "[safe]\n directory = /source\n");
    env.GIT_CONFIG_GLOBAL = "/tmp/zini-gitconfig";
  }
  const safe = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.pager=cat", "-c", "credential.helper=", "-c", "core.sshCommand=false", "-c", "protocol.ext.allow=never", "-c", `protocol.file.allow=${localSource ? "always" : "never"}`, "-c", "http.followRedirects=false", "-c", `safe.directory=${root}`, "-c", "user.name=Zini", "-c", "user.email=zini@localhost"];
  if (localSource) safe.push("-c", "safe.directory=/source");
  try {
    const { stdout } = await promisify(execFile)("git", [...safe, "-C", root, ...args], { env, maxBuffer: 50 * 1024 * 1024 });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof result.code === "number" ? result.code : 1, stdout: result.stdout ?? "", stderr: result.stderr ?? String(error) };
  }
}
