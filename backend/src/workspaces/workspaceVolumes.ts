import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { storage } from "../db.js";
import { docker, dockerInput } from "./docker.js";
import { withWorkspaceLock } from "./workspaceLocks.js";
import { forgetGitSandbox, registerGitSandbox, trustedGit } from "./trustedGit.js";

export const sandboxImage = "zini-workspace:1";
export const sandboxRoot = resolve(import.meta.dirname, "../../..");
export const sandboxOwner = createHash("sha256").update(sandboxRoot).digest("hex").slice(0,16);
export const identityForStorage = (path = storage) => createHash("sha256").update(resolve(path)).digest("hex");
export const workspaceIdentity = identityForStorage();
export function sandboxName(issueId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(issueId)) throw new Error("Invalid workspace ID");
  return `zini-workspace-${issueId}`;
}
export const workspaceVolume = (issueId: string) => `${sandboxName(issueId)}-files`;
const ready = new Set<string>();
const pending = new Map<string, Promise<string>>();

export async function resource(kind: "network" | "volume", name: string) {
  try { return JSON.parse(await docker([kind, "inspect", name]))[0]; }
  catch (error) { if (/not found|No such/i.test(String((error as { stderr?: string }).stderr))) return null; throw error; }
}
export async function ownedResource(kind: "network" | "volume", name: string, labels: Record<string,string> = {}) {
  const info = await resource(kind, name);
  if (info) {
    if (info.Labels?.["zini.owner"] !== sandboxOwner || Object.entries(labels).some(([key,value]) => info.Labels?.[key] !== value)) throw new Error(`Unowned ${kind} ${name}`);
    return;
  }
  await docker([kind, "create", "--label", `zini.owner=${sandboxOwner}`, ...Object.entries(labels).flatMap(([key,value]) => ["--label", `${key}=${value}`]), name]);
}
export async function removeOwnedResource(kind: "network" | "volume", name: string) {
  const info = await resource(kind, name); if (!info) return;
  if (info.Labels?.["zini.owner"] !== sandboxOwner) throw new Error(`Refusing to remove unowned ${kind}`);
  await docker([kind, "rm", name]);
}
export async function volumeHelper(issueId: string, request: unknown, source?: string) {
  const args = ["run", "--rm", "-i", "--user", "1000:1000", "--cpus", "2", "--memory", "4g", "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=64m", "--network", "bridge", "--label", `zini.owner=${sandboxOwner}`, "--label", `zini.workspace=${issueId}`, "--label", "zini.role=trusted-git",
    "--mount", `type=volume,source=${workspaceVolume(issueId)},target=/volume`,
    ...(source ? ["--mount", `type=bind,source=${source},target=/source,readonly`] : []),
    "--entrypoint", "/opt/zini/node_modules/.bin/tsx", sandboxImage, "/opt/zini/sandbox/trustedGit.ts"];
  const result = JSON.parse(await dockerInput(args, request));
  if (result.error) throw new Error(result.error);
  return result;
}
export const gitHelperName = (issueId: string) => `${sandboxName(issueId)}-git`;

// The sandbox image's current build. Containers keep the build they were created from,
// so one made from an older build is recreated: its gateway and Git helper code are
// baked into the image. Checked once per container until the image is built again (or
// the backend restarts), as every gateway request ensures its sandbox.
export const sandboxImageId = async () => (await docker(["image", "inspect", "--format", "{{.Id}}", sandboxImage])).trim();
const checkedImages = new Set<string>();
export const forgetImageChecks = () => checkedImages.clear();
export async function outdatedImage(name: string, image: string) {
  if (checkedImages.has(name)) return false;
  checkedImages.add(name);
  return image !== await sandboxImageId();
}

async function inspectGitHelper(issueId: string, expectedIdentity = workspaceIdentity) {
  let info;
  try { info = JSON.parse(await docker(["inspect", gitHelperName(issueId)]))[0]; }
  catch (error) { if (/No such/i.test(String((error as { stderr?: string }).stderr))) return null; throw error; }
  const labels = info.Config.Labels;
  if (labels?.["zini.owner"] !== sandboxOwner || labels?.["zini.workspace"] !== issueId || labels?.["zini.storage"] !== expectedIdentity || labels?.["zini.role"] !== "trusted-git") throw new Error("Unowned workspace Git helper");
  return info;
}

async function gitHelper(issueId: string, request: unknown) {
  let info = await inspectGitHelper(issueId);
  // It holds no state of its own: only the workspace volume is mounted.
  if (info && await outdatedImage(gitHelperName(issueId), info.Image)) {
    await docker(["rm", "-f", gitHelperName(issueId)]);
    info = null;
  }
  if (!info) {
    await docker(["run", "-d", "--name", gitHelperName(issueId), "--user", "1000:1000", "--cpus", "2", "--memory", "4g", "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=64m", "--network", "bridge",
      "--label", `zini.owner=${sandboxOwner}`, "--label", `zini.workspace=${issueId}`, "--label", `zini.storage=${workspaceIdentity}`, "--label", "zini.role=trusted-git",
      "--mount", `type=volume,source=${workspaceVolume(issueId)},target=/volume`, "--entrypoint", "/bin/sleep", sandboxImage, "infinity"]);
  } else if (!info.State.Running) await docker(["start", gitHelperName(issueId)]);
  const result = JSON.parse(await dockerInput(["exec", "-i", gitHelperName(issueId), "/opt/zini/node_modules/.bin/tsx", "/opt/zini/sandbox/trustedGit.ts"], request));
  if (result.error) throw new Error(result.error);
  return result;
}

// One lock and freeze covers the entire semantic operation, including all its Git commands.
export async function workspaceGitOperation<T>(issueId: string, request: unknown): Promise<T> {
  return withWorkspaceLock(issueId, async () => {
    await ensureWorkspaceVolume(issueId);
    const { workspacePath } = await import("../repositories/git.js");
    return trustedGit(workspacePath(issueId), () => gitHelper(issueId, request));
  });
}

async function prepareVolume(issueId: string) {
  await ownedResource("volume", workspaceVolume(issueId), { "zini.workspace": issueId, "zini.storage": workspaceIdentity });
  await docker(["run", "--rm", "--network", "none", "--mount", `type=volume,source=${workspaceVolume(issueId)},target=/volume`, "--entrypoint", "/bin/sh", sandboxImage, "-c", "chown 1000:1000 /volume"]);
}
export function ensureWorkspaceVolume(issueId: string) {
  if (ready.has(issueId)) return Promise.resolve(workspaceVolume(issueId));
  let promise = pending.get(issueId);
  if (!promise) {
    promise = withWorkspaceLock(issueId, async () => {
      const info = await resource("volume", workspaceVolume(issueId));
      if (!info) throw new Error("Workspace volume has not been initialized");
      if (info.Labels?.["zini.owner"] !== sandboxOwner || info.Labels?.["zini.workspace"] !== issueId || info.Labels?.["zini.storage"] !== workspaceIdentity) throw new Error("Workspace volume belongs to a different installation or data directory");
      if (!(await volumeHelper(issueId, { operation: "ready" })).ready) throw new Error("Workspace volume has not been initialized");
      const { workspacePath } = await import("../repositories/git.js");
      try {
        const info = JSON.parse(await docker(["inspect", sandboxName(issueId)]))[0];
        if (info.State.Running && info.Config.Labels?.["zini.storage"] === workspaceIdentity) registerGitSandbox(workspacePath(issueId), sandboxName(issueId));
      } catch (error) { if (!/No such/i.test(String((error as { stderr?: string }).stderr))) throw error; }
      ready.add(issueId);
      return workspaceVolume(issueId);
    }).finally(() => pending.delete(issueId));
    pending.set(issueId, promise);
  }
  return promise;
}
export async function cloneWorkspaceVolume(issueId: string, branch: string, ref: string, url: string, defaultRef: string) {
  await withWorkspaceLock(issueId, async () => {
    await prepareVolume(issueId);
    await volumeHelper(issueId, { operation: "clone", branch, ref, url, defaultRef }, resolve(dirname(storage), "repo.git"));
    const { workspacePath } = await import("../repositories/git.js");
    await mkdir(workspacePath(issueId), { recursive: true });
    await writeFile(resolve(workspacePath(issueId), ".docker-volume"), workspaceVolume(issueId));
    ready.add(issueId);
  });
}
export async function removeWorkspaceVolume(issueId: string, expectedIdentity = workspaceIdentity) {
  const info = await resource("volume", workspaceVolume(issueId));
  if (info && info.Labels?.["zini.storage"] !== expectedIdentity) throw new Error("Workspace volume belongs to a different data directory");
  if (await inspectGitHelper(issueId, expectedIdentity)) await docker(["rm", "-f", gitHelperName(issueId)]);
  await removeOwnedResource("volume", workspaceVolume(issueId));
  ready.delete(issueId);
}
export async function workspaceGit(issueId: string, args: string[], token?: string) {
  const result = await workspaceGitOperation<{ code: number; stdout: string; stderr: string }>(issueId, { operation: "git", args, token });
  if (result.code) throw Object.assign(new Error(result.stderr), result);
  return result.stdout;
}

// Refresh from the trusted host cache, also used by evals with a local upstream.
export async function refreshWorkspaceRefs(issueId: string) {
  await volumeHelper(issueId, { operation: "refresh" }, resolve(dirname(storage), "repo.git"));
}
