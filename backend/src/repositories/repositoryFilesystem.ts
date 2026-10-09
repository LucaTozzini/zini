import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import micromatch from "micromatch";
import {
  applyGrepMaxCount,
  createFilesystemMiddleware,
  FilesystemBackend,
  type BackendProtocolV2,
  type FileInfo,
  type GrepResult,
} from "deepagents";

export type RepositoryGit = (args: string[], exit1Ok?: boolean) => Promise<string>;

// Tool paths are virtual, never host paths. Reject Windows drive/UNC/ADS paths even
// on Linux, so moving a coordinator between hosts does not change its permissions.
export function repositoryPath(path: string) {
  if (/[\0:]/.test(path) || path.startsWith("\\\\") || path.startsWith("//"))
    throw new Error("Use a path inside the repository, not a host path");
  const parts = path.replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === ".." || part.startsWith("~") || part.toLowerCase() === ".git"))
    throw new Error("Path traversal and .git access are not allowed");
  return parts.join("/");
}

// Check the deepest existing parent too: a new file under an escaping symlink is
// just as unsafe as reading an existing file through it. Fail closed on I/O errors.
export async function checkedRepositoryPath(root: string, path: string) {
  const rel = repositoryPath(path);
  const realRoot = await realpath(root);
  let anchor = resolve(root, rel);
  for (;;) {
    try {
      const real = await realpath(anchor);
      const actual = relative(realRoot, real);
      if (actual === ".." || actual.startsWith(`..${sep}`) || isAbsolute(actual))
        throw new Error("Path resolves outside the repository");
      repositoryPath(actual);
      return rel;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(anchor);
      if (parent === anchor) throw error;
      anchor = parent;
    }
  }
}

export const virtualPath = (path: string) => `/${repositoryPath(path)}`;
const matches = (path: string, pattern: string) =>
  micromatch.isMatch(path, pattern, { dot: true }) ||
  (!pattern.includes("/") && micromatch.isMatch(posix.basename(path), pattern, { dot: true }));

export function globFiles(files: FileInfo[], pattern: string, path = "/") {
  const base = repositoryPath(path);
  const prefix = base ? `${base}/` : "";
  const glob = repositoryPath(pattern);
  return files.filter((file) => {
    const name = repositoryPath(file.path);
    return name.startsWith(prefix) && matches(name.slice(prefix.length), glob);
  });
}

// Git supplies the candidate set, including untracked edits but excluding ignored
// output. No recursive disk fallback that could scan dependencies or Git metadata.
export async function gitFiles(git: RepositoryGit): Promise<FileInfo[]> {
  const out = await git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return [...new Set(out.split("\0").filter(Boolean))].flatMap((path) => {
    try { return [{ path: virtualPath(path), is_dir: false }]; }
    catch { return []; }
  });
}

export async function gitGrep(git: RepositoryGit, pattern: string, path = "/", glob?: string | null,
  maxCount?: number | null): Promise<GrepResult> {
  if (!pattern) return { error: "Search pattern must not be empty" };
  const base = repositoryPath(path);
  const out = await git(["grep", "-n", "-z", "-I", "-F", "--untracked",
    "-e", pattern, "--", ...(base ? [`:(literal)${base}`] : ["."])], true);
  const found = [...out.matchAll(/([^\0]+)\0(\d+)\0([^\n]*)(?:\n|$)/g)].flatMap((match) => {
    const name = match[1]!;
    try {
      const path = virtualPath(name);
      return !glob || matches(repositoryPath(path), repositoryPath(glob))
        ? [{ path, line: Number(match[2]), text: match[3]! }] : [];
    } catch { return []; }
  });
  return applyGrepMaxCount({ result: { matches: found }, maxCount });
}

// A policy layer over LangChain's disk backend; content I/O and exact edits remain
// the library's implementation. Discovery retains our Git-aware repository view.
export class RepositoryFilesystemBackend extends FilesystemBackend {
  constructor(root: string, private git: RepositoryGit, private writable = false,
    private notify: () => void = () => {}) {
    super({ rootDir: root, virtualMode: true });
  }
  async read(path: string, offset?: number, limit?: number) {
    await checkedRepositoryPath(this.cwd, path);
    return super.read(virtualPath(path), offset, limit);
  }
  async readRaw(path: string) {
    await checkedRepositoryPath(this.cwd, path);
    return super.readRaw(virtualPath(path));
  }
  async ls(path: string) {
    await checkedRepositoryPath(this.cwd, path);
    const [result, files] = await Promise.all([super.ls(virtualPath(path)), gitFiles(this.git)]);
    return { ...result, files: result.files?.filter((entry) => files.some((file) =>
      entry.is_dir ? file.path.startsWith(entry.path) : file.path === entry.path)) };
  }
  async glob(pattern: string, path = "/") {
    await checkedRepositoryPath(this.cwd, path);
    const candidates = globFiles(await gitFiles(this.git), pattern, path);
    const files: FileInfo[] = [];
    for (const file of candidates) {
      try { await checkedRepositoryPath(this.cwd, file.path); await realpath(resolve(this.cwd, repositoryPath(file.path))); files.push(file); }
      catch { /* Deleted files and unsafe symlinks aren't discoverable. */ }
    }
    return { files };
  }
  async grep(pattern: string, path = "/", glob?: string | null, maxCount?: number | null) {
    await checkedRepositoryPath(this.cwd, path);
    return gitGrep(this.git, pattern, path, glob, maxCount);
  }
  async write(path: string, content: string) {
    if (!this.writable) return { error: "Repository is read-only" };
    await checkedRepositoryPath(this.cwd, path);
    const result = await super.write(virtualPath(path), content);
    if (!result.error) this.notify();
    return result;
  }
  async edit(path: string, oldString: string, newString: string, replaceAll = false) {
    if (!this.writable) return { error: "Repository is read-only" };
    await checkedRepositoryPath(this.cwd, path);
    if (!oldString) return { error: "old_string must not be empty" };
    const result = await super.edit(virtualPath(path), oldString, newString, replaceAll);
    if (!result.error) this.notify();
    return result;
  }
}

// Leave tool schemas, descriptions, and read formatting to the toolkit. Surface
// backend errors as failures so our tool-error middleware and logs can see them.
export function repositoryFilesystem(backend: BackendProtocolV2, writable = false) {
  const checked = async <T extends { error?: string }>(result: T | Promise<T>): Promise<T> => {
    const value = await result;
    if (value.error) throw new Error(value.error);
    return value;
  };
  const guarded: BackendProtocolV2 = {
    ls: (...args) => checked(backend.ls(...args)), glob: (...args) => checked(backend.glob(...args)),
    grep: (...args) => checked(backend.grep(...args)), readRaw: (...args) => checked(backend.readRaw(...args)),
    write: (...args) => checked(backend.write(...args)), edit: (...args) => checked(backend.edit(...args)),
    read: (...args) => checked(backend.read(...args)),
  };
  return createFilesystemMiddleware({
    backend: guarded,
    tools: ["ls", "read_file", "glob", "grep", ...(writable ? ["write_file", "edit_file"] as const : [])],
    permissions: writable ? [] : [{ operations: ["write"], paths: ["/**"], mode: "deny" }],
    // Our existing compaction owns context management; do not create repo artifacts.
    toolTokenLimitBeforeEvict: null,
    humanMessageTokenLimitBeforeEvict: null,
    grepMaxCount: 100,
  });
}
