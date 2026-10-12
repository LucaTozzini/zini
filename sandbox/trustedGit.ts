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
  } else if (request.operation === "git") {
    await validateGit(root);
    if (request.token && !request.args.some((arg: string) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(arg))) throw new Error("Authenticated Git requires an explicit GitHub repository URL");
    console.log(JSON.stringify(await executeGit(root, request.args, request.token)));
  } else throw new Error("Unknown trusted Git operation");
} catch (error) {
  console.log(JSON.stringify({ error: String(error) }));
} finally { request.token = undefined; }
