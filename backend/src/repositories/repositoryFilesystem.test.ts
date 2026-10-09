import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createAgent, toolErrorMiddleware } from "langchain";
import { checkedRepositoryPath, RepositoryFilesystemBackend, repositoryFilesystem,
  repositoryPath, type RepositoryGit } from "./repositoryFilesystem.js";

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "zini-file-tools-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "repo");
  await mkdir(root);
  const git: RepositoryGit = async (args, exit1Ok = false) => {
    try { return (await promisify(execFile)("git", ["-C", root, ...args])).stdout; }
    catch (error) { if (exit1Ok && (error as { code?: number }).code === 1) return (error as { stdout?: string }).stdout ?? ""; throw error; }
  };
  await git(["init", "--quiet"]);
  await mkdir(join(root, "src"));
  await mkdir(join(root, ".github"));
  await writeFile(join(root, "src", "app.ts"), 'const x = "hello";\n\n  return x;\n');
  await writeFile(join(root, ".github", "ci.yml"), "hello CI\n");
  await writeFile(join(root, ".gitignore"), "ignored/\n");
  await git(["add", "."]);
  await git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture"]);
  await mkdir(join(root, "ignored"));
  await writeFile(join(root, "ignored", "secret.ts"), "hello ignored\n");
  await writeFile(join(root, "src", "new.ts"), "hello untracked\n");
  return { root, dir, git };
}

type Call = { name: string; args: Record<string, unknown> };
class ScriptedModel extends BaseChatModel {
  index = 0;
  visibleTools: string[] = [];
  constructor(private calls: Call[]) { super({}); }
  _llmType() { return "file-tools-test"; }
  bindTools(tools: unknown[]) {
    this.visibleTools = tools.map((tool) => (tool as { name: string }).name);
    return this;
  }
  async _generate(_messages: BaseMessage[]) {
    const call = this.calls[this.index++];
    const message = call ? new AIMessage({ content: "", tool_calls: [{ ...call, id: `call-${this.index}` }] })
      : new AIMessage("Done");
    return { generations: [{ text: "", message }] };
  }
}

async function runTools(backend: RepositoryFilesystemBackend, calls: Call[], writable = false) {
  const model = new ScriptedModel(calls);
  const agent = createAgent({ model, tools: [], checkpointer: false, middleware: [
    toolErrorMiddleware({ onError: (error) => String(error) }), repositoryFilesystem(backend, writable),
  ] });
  const result = await agent.invoke({ messages: [{ role: "user", content: "Exercise filesystem tools" }] });
  return { model, results: result.messages.filter(ToolMessage.isInstance) };
}

test("native read output preserves paginated source including blank lines and indentation", async (t) => {
  const { root, git } = await fixture(t);
  const { results, model } = await runTools(new RepositoryFilesystemBackend(root, git), [
    { name: "read_file", args: { file_path: "/src/app.ts", offset: 1, limit: 2 } },
    { name: "read_file", args: { file_path: "/src/app.ts", offset: 1, limit: 1 } },
  ]);
  assert.match(results[0]!.text, /^@@ .*lines 2-3.* @@\n/);
  assert.equal(results[0]!.text.split("\n").slice(1).join("\n"), "\n  return x;");
  assert.match(results[1]!.text, /^@@ .*lines 2-2.* @@\n/);
  assert.equal(results[1]!.text.split("\n").slice(1).join("\n"), "");
  assert.deepEqual(model.visibleTools.sort(), ["glob", "grep", "ls", "read_file"]);
});

test("native writes and exact edits notify only on success; failed edits are logged as errors", async (t) => {
  const { root, git } = await fixture(t);
  let notifications = 0;
  const backend = new RepositoryFilesystemBackend(root, git, true, () => notifications++);
  const { results, model } = await runTools(backend, [
    { name: "write_file", args: { file_path: "/added.txt", content: "one one\n" } },
    { name: "edit_file", args: { file_path: "/added.txt", old_string: "missing", new_string: "two" } },
    { name: "edit_file", args: { file_path: "/added.txt", old_string: "one", new_string: "two" } },
    { name: "edit_file", args: { file_path: "/added.txt", old_string: "one", new_string: "two", replace_all: true } },
    { name: "edit_file", args: { file_path: "/src/app.ts", old_string: 'const x = "hello";', new_string: 'const x = "world";' } },
  ], true);
  assert.ok(model.visibleTools.includes("write_file") && model.visibleTools.includes("edit_file"));
  assert.equal(results[1]!.status, "error");
  assert.equal(results[2]!.status, "error");
  assert.equal(notifications, 3);
  assert.equal(await readFile(join(root, "added.txt"), "utf8"), "two two\n");
  assert.match(await readFile(join(root, "src/app.ts"), "utf8"), /world/);
});

test("Git-aware discovery includes untracked and hidden source but not ignored files or .git", async (t) => {
  const { root, git } = await fixture(t);
  const backend = new RepositoryFilesystemBackend(root, git);
  const listed = await backend.ls("/");
  assert.ok(listed.files?.some((file) => file.path === "/.github/"));
  assert.ok(!listed.files?.some((file) => file.path === "/.git/" || file.path === "/ignored/"));
  assert.deepEqual((await backend.glob("**/*.ts")).files.map((file) => file.path).sort(), ["/src/app.ts", "/src/new.ts"]);
  const { results } = await runTools(backend, [
    { name: "grep", args: { pattern: "hello", output_mode: "content" } },
    { name: "glob", args: { pattern: "**/*.yml" } },
  ]);
  assert.match(results[0]!.text, /ci\.yml:[\s\S]*hello CI/);
  assert.match(results[0]!.text, /new\.ts:[\s\S]*hello untracked/);
  assert.doesNotMatch(results[0]!.text, /ignored|\.git\//);
  assert.match(results[1]!.text, /\.github\/ci\.yml/);
  const capped = await backend.grep("hello", "/", null, 1);
  assert.equal(capped.matches?.length, 1);
  assert.equal(capped.truncated, true);
  assert.deepEqual((await backend.grep("hello", "/src/app.ts")).matches?.map((match) => match.path), ["/src/app.ts"]);
  assert.deepEqual((await backend.grep("hello", "/", "**/*.yml")).matches?.map((match) => match.path), ["/.github/ci.yml"]);
});

test("read-only tools and backend reject writes without changing files", async (t) => {
  const { root, git } = await fixture(t);
  const backend = new RepositoryFilesystemBackend(root, git);
  assert.match((await backend.write("/src/app.ts", "bad")).error!, /read-only/);
  const { results } = await runTools(backend, [
    { name: "write_file", args: { file_path: "/src/app.ts", content: "bad" } },
  ]);
  assert.equal(results[0]!.status, "error");
  assert.match(await readFile(join(root, "src/app.ts"), "utf8"), /hello/);
});

test("paths reject traversal, Windows host paths, ADS, .git, and symlink/junction escapes", async (t) => {
  const { root, dir, git } = await fixture(t);
  for (const path of ["../file", "/../file", "src/../../file", "src\\..\\file", "C:\\file", "\\\\host\\share", "file:stream", ".git/config", "src/.GIT/config"])
    assert.throws(() => repositoryPath(path));
  assert.equal(repositoryPath("./src/app.ts"), "src/app.ts");
  assert.equal(repositoryPath("/src/app.ts"), "src/app.ts");
  const outside = join(dir, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "private");
  await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  await symlink(join(root, ".git"), join(root, "metadata"), process.platform === "win32" ? "junction" : "dir");
  const backend = new RepositoryFilesystemBackend(root, git, true);
  for (const path of ["escape/secret.txt", "escape/new/child.txt", "metadata/config"])
    await assert.rejects(checkedRepositoryPath(root, path));
  await assert.rejects(backend.read("escape/secret.txt"));
  await assert.rejects(backend.write("escape/new/child.txt", "bad"));
  await assert.rejects(backend.edit("metadata/config", "x", "y"));
  assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "private");
});
