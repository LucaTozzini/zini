import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { RepositoryFilesystemBackend, checkedRepositoryPath } from "../backend/src/repositories/repositoryFilesystem.js";
import { executeGit } from "./gitPolicy.js";

const root = "/workspace";
const git = async (args: string[], exit1Ok = false) => {
  const result = await executeGit(root, args);
  if (result.code && !(exit1Ok && result.code === 1)) throw new Error(result.stderr);
  return result.stdout;
};
const backend = new RepositoryFilesystemBackend(root, git, true);
const methods = new Set(["read", "readRaw", "ls", "glob", "grep", "write", "edit"]);

export async function filesystem(request: { method: string; args: any[] }) {
  if (!methods.has(request.method)) throw new Error("Unknown filesystem operation");
  return (backend[request.method as keyof RepositoryFilesystemBackend] as (...args: any[]) => unknown).apply(backend, request.args);
}

export async function workspaceFile(request: { operation: string; path: string; to?: string }) {
  const rel = await checkedRepositoryPath(root, request.path);
  const full = join(root, rel);
  if (request.operation === "fingerprint") {
    if (!existsSync(full) || !(await stat(full)).isFile()) return null;
    return createHash("sha256").update(await readFile(full)).digest("hex");
  }
  if (request.operation === "readText") return readFile(full, "utf8");
  if (request.operation === "cwd") {
    if (!(await stat(full)).isDirectory()) throw new Error(`${request.path} is not a directory`);
    return full;
  }
  if (!(await stat(full)).isFile()) throw new Error(`${rel} is not a file`);
  if (request.operation === "delete") { await rm(full); return `Deleted ${rel}`; }
  if (request.operation === "move") {
    const target = await checkedRepositoryPath(root, request.to!);
    if (existsSync(join(root, target))) throw new Error(`${target} already exists`);
    await mkdir(dirname(join(root, target)), { recursive: true });
    await rename(full, join(root, target));
    return `Moved ${rel} to ${target}`;
  }
  throw new Error("Unknown file operation");
}
