import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { executeGit, validateGit } from "./gitPolicy.js";

const root = "/volume/repo";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
input = "";
try {
  if (request.operation === "ready") {
    console.log(JSON.stringify({ ready: existsSync("/volume/ready.json") }));
  } else if (request.operation === "clone") {
    if (existsSync("/volume/ready.json")) throw new Error("Workspace volume is already initialized");
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    {
      const result = await executeGit(root, ["clone", "--no-hardlinks", "--quiet", "/source", "."], undefined, true);
      if (result.code) throw new Error(result.stderr);
      for (const args of [
        ["fetch", "--quiet", "/source", "+refs/remotes/origin/*:refs/remotes/origin/*"],
        ["checkout", "--quiet", "-B", request.branch, request.ref],
        ["remote", "set-url", "origin", request.url],
        ["symbolic-ref", "refs/remotes/origin/HEAD", request.defaultRef],
      ]) {
        const result = await executeGit(root, args, undefined, true);
        if (result.code) throw new Error(result.stderr);
      }
    }
    await validateGit(root);
    await writeFile("/volume/ready.json", JSON.stringify({ version: 1 }));
    console.log(JSON.stringify({ ready: true }));
  } else if (request.operation === "refresh") {
    await validateGit(root);
    const result = await executeGit(root, ["fetch", "--quiet", "--prune", "/source", "+refs/remotes/origin/*:refs/remotes/origin/*"], undefined, true);
    if (result.code) throw new Error(result.stderr);
    console.log(JSON.stringify({ ready: true }));
  } else if (request.operation === "diff") {
    await validateGit(root);
    const run = async (args: string[], exit1Ok = false) => {
      const result = await executeGit(root, args);
      if (result.code && !(exit1Ok && result.code === 1)) throw new Error(result.stderr);
      return result.stdout;
    };
    const path = request.path ?? "";
    if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || path.includes("\0")) throw new Error("Invalid diff path");
    // During a merge the working tree already holds the merged-in branch's changes, so
    // compare with that commit: it becomes the merge base once the merge is committed.
    const merging = (await run(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], true)).trim();
    const base = request.uncommitted ? "HEAD" : merging || (await run(["merge-base", "HEAD", "origin/HEAD"])).trim();
    const paths = path ? [path] : [];
    const changes = request.summary ? (await run(["diff", "--numstat", "-z", "--no-renames", base, "--", ...paths])).split("\0").filter(Boolean).map(record => {
      const [added, removed, ...rest] = record.split("\t");
      return { path: rest.join("\t"), added, removed, isNew: false };
    }) : [];
    let diff = request.patch ? await run(["diff", "--no-color", "--no-renames", base, "--", ...paths]) : "";
    const max = 2 * 1024 * 1024;
    const untracked = (await run(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(file => file && (!path || file === path || file.startsWith(`${path}/`)));
    for (const file of untracked) {
      if (request.summary) {
        const numstat = await run(["diff", "--numstat", "--no-index", "--", "/dev/null", file], true);
        const [added = "0", removed = "0"] = numstat.split("\t");
        changes.push({ path: file, added, removed, isNew: true });
      }
      if (request.patch && diff.length <= max) diff += await run(["diff", "--no-color", "--no-index", "--", "/dev/null", file], true);
    }
    const truncated = diff.length > max;
    if (truncated) diff = diff.slice(0, diff.lastIndexOf("\ndiff --git ", max) + 1 || max);
    changes.sort((a, b) => a.path.localeCompare(b.path));
    console.log(JSON.stringify({ diff, truncated, changes }));
  } else if (request.operation === "git") {
    await validateGit(root);
    if (request.token && !request.args.some((arg: string) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(arg))) throw new Error("Authenticated Git requires an explicit GitHub repository URL");
    console.log(JSON.stringify(await executeGit(root, request.args, request.token)));
  } else throw new Error("Unknown trusted Git operation");
} catch (error) {
  console.log(JSON.stringify({ error: String(error) }));
} finally { request.token = undefined; }
