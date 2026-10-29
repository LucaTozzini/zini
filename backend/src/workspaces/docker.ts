import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

// Whether the Docker engine answers. Checked at most every few seconds, since the webapp
// asks regularly and `docker info` is slow while Docker is down or starting.
const CHECK_MS = 4000;
let check: { at: number; running: Promise<boolean> } | undefined;
export function dockerRunning() {
  if (!check || Date.now() - check.at > CHECK_MS)
    check = {
      at: Date.now(),
      running: exec("docker", ["info"], { windowsHide: true, timeout: 15000 }).then(
        () => true,
        () => false,
      ),
    };
  return check.running;
}

// Starting Docker takes a while: until it answers, or for this long, it counts as starting.
const STARTING_MS = 3 * 60 * 1000;
let startedAt = 0;
export async function dockerStatus() {
  const running = await dockerRunning();
  return { running, starting: !running && Date.now() - startedAt < STARTING_MS };
}

// Starts Docker Desktop on this machine, without waiting for it to be up.
export async function startDocker() {
  if (process.platform === "win32") {
    const app = join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe");
    if (!existsSync(app)) throw new Error(`Docker Desktop isn't at ${app}. Start Docker yourself.`);
    spawn(app, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (process.platform === "darwin") {
    await exec("open", ["-a", "Docker"]);
  } else {
    await exec("systemctl", ["--user", "start", "docker-desktop"]);
  }
  startedAt = Date.now();
  check = undefined;
}
