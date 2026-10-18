import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export async function docker(args: string[]) {
  return (
    await exec("docker", args, {
      windowsHide: true,
      timeout: args[0] === "build" ? 600000 : args[0] === "pull" ? 180000 : 30000,
      maxBuffer: 50 * 1024 * 1024,
    })
  ).stdout;
}

// Credentials travel over stdin, never Docker arguments, environment or image files.
export function dockerInput(args: string[], request: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr || `Docker helper exited ${code}`))));
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request));
  });
}
