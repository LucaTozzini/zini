import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { workspacePath } from "../repositories/git.js";
import { withWorkspaceLock } from "./workspaceLocks.js";
import { registerGitSandbox, forgetGitSandbox, trustedGit } from "./trustedGit.js";
import { docker } from "./docker.js";
import { sandboxImage, sandboxRoot, sandboxOwner as owner, sandboxName, workspaceIdentity, identityForStorage, workspaceVolume, ensureWorkspaceVolume, ownedResource, removeOwnedResource, removeWorkspaceVolume, resource } from "./workspaceVolumes.js";
export { docker } from "./docker.js";
export { sandboxImage, sandboxName } from "./workspaceVolumes.js";

const root = sandboxRoot;
const pending = new Map<string, Promise<Sandbox>>();
export type Sandbox = { name: string; port: number; token: string; generation?: string };
export async function buildSandboxImage() { await docker(["build", "-f", resolve(root, "sandbox/Dockerfile"), "-t", sandboxImage, root]); }
async function inspect(name: string) {
  try { return JSON.parse(await docker(["inspect", name]))[0]; }
  catch (error) { if (/No such (object|container)/i.test(String((error as { stderr?: string }).stderr))) return null; throw error; }
}
export async function existingSandbox(issueId: string): Promise<Sandbox | null> {
  const name = sandboxName(issueId); const info = await inspect(name);
  if (!info) return null;
  if (info.Config.Labels?.["zini.owner"] !== owner || info.Config.Labels?.["zini.workspace"] !== issueId) throw new Error("Container name belongs to a different Zini installation");
  if (!info.Mounts?.some((mount: { Name?: string; Destination: string }) => mount.Name === workspaceVolume(issueId) && mount.Destination === "/workspace")) return null;
  if (info.Config.Labels?.["zini.storage"] !== workspaceIdentity) throw new Error("Workspace container belongs to a different data directory");
  if (!info.State.Running || info.State.Paused) return null;
  const mappings = info.NetworkSettings?.Ports?.["7777/tcp"] ?? [];
  const mapping = mappings[0];
  const token = info.Config.Env?.find((entry: string) => entry.startsWith("WORKSPACE_TOKEN="))?.slice(16);
  if (!mapping || mapping.HostIp !== "127.0.0.1" || !token) {
    const failures = [
      !mapping && "no published port for 7777/tcp",
      mapping && mapping.HostIp !== "127.0.0.1" && "gateway port is not bound to 127.0.0.1",
      !token && "WORKSPACE_TOKEN is missing or empty",
    ].filter(Boolean);
    // Log selected configuration fields only: Env contains the gateway secret.
    throw new Error(`Invalid workspace gateway configuration: ${failures.join("; ")}. ${JSON.stringify({
      issueId, container: name, containerId: info.Id, status: info.State.Status,
      startedAt: info.State.StartedAt, restartCount: info.RestartCount,
      publishedPorts: mappings, configuredPorts: info.HostConfig?.PortBindings?.["7777/tcp"] ?? [],
      networks: Object.keys(info.NetworkSettings?.Networks ?? {}), hasToken: Boolean(token),
    })}`);
  }
  registerGitSandbox(workspacePath(issueId), name);
  return { name, port: Number(mapping.HostPort), token, generation: `${info.Id}:${info.State.StartedAt}` };
}
export function ensureSandbox(issueId: string) {
  let promise = pending.get(issueId);
  if (!promise) { promise = withWorkspaceLock(issueId, () => create(issueId)).finally(() => pending.delete(issueId)); pending.set(issueId, promise); }
  return promise;
}
async function create(issueId: string) {
  const name = sandboxName(issueId);
  try {
    await ensureWorkspaceVolume(issueId);
    let sandbox = await existingSandbox(issueId);
    // Storage is initialized or verified before a gateway starts using it.
    if (!sandbox) {
      const info = await inspect(name);
      if (info) await docker([info.State.Paused ? "unpause" : "start", name]);
      else {
        await docker(["image", "inspect", sandboxImage]);
        const volume = `${name}-state`;
        const network = `${name}-network`;
        await ownedResource("network", network);
        await ownedResource("volume", volume);
        await docker(["run", "-d", "--name", name, "--init", "--restart", "unless-stopped",
          "--network", network,
          "--label", `zini.owner=${owner}`, "--label", `zini.workspace=${issueId}`,
          "--label", `zini.storage=${workspaceIdentity}`,
          "--cpus", "2", "--memory", "4g", "--pids-limit", "512", "--shm-size", "256m",
          "--cap-drop", "ALL", "--cap-add", "NET_ADMIN", "--cap-add", "SETUID", "--cap-add", "SETGID", "--cap-add", "SETPCAP", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE",
          "--security-opt", "no-new-privileges", "--sysctl", "net.ipv6.conf.all.disable_ipv6=1",
          "-p", "127.0.0.1::7777", "--mount", `type=volume,source=${workspaceVolume(issueId)},target=/workspace,volume-subpath=repo`,
          "--mount", `type=volume,source=${volume},target=/state`,
          "-e", `WORKSPACE_ID=${issueId}`, "-e", `WORKSPACE_TOKEN=${randomBytes(32).toString("hex")}`, sandboxImage]);
      }
      sandbox = await existingSandbox(issueId);
    }
    if (!sandbox) throw new Error("Workspace container did not start");
    for (let attempt = 0; attempt < 60; attempt++) {
      const health = await sandboxRequest<{ ok: boolean }>(sandbox, "health", {}, AbortSignal.timeout(1000)).catch(() => null);
      if (health?.ok) {
        const { restoreWorkspaceServices } = await import("./workspaceServices.js");
        await restoreWorkspaceServices(issueId, sandbox);
        return sandbox;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Workspace gateway did not become ready. Inspect docker logs ${name}`);
  } catch (error) { throw new Error(`Docker workspace unavailable; commands were not run on the host. ${String(error)}. Build the image with npm run sandbox:build and start Docker.`); }
}
export async function sandboxRequest<T = any>(sandbox: Sandbox, action: string, body: unknown = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${sandbox.port}/${action}`, {
    method: "POST", headers: { "content-type": "application/json", "x-workspace-token": sandbox.token }, body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(action === "appLaunch" ? 2700000 : 30000)]) : AbortSignal.timeout(action === "appLaunch" ? 2700000 : 30000),
  });
  const result = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(result.error ?? `Gateway returned ${response.status}`); return result;
}
export async function workspaceRequest<T = any>(issueId: string, action: string, body: unknown = {}, signal?: AbortSignal) {
  return sandboxRequest<T>(await ensureSandbox(issueId), action, body, signal);
}
export async function removeSandbox(issueId: string, storagePath?: string) {
  return withWorkspaceLock(issueId, () => remove(issueId, storagePath));
}
async function remove(issueId: string, storagePath?: string) {
  const name = sandboxName(issueId);
  const expectedIdentity = identityForStorage(storagePath);
  const files = await resource("volume", workspaceVolume(issueId));
  if (files && (files.Labels?.["zini.owner"] !== owner || files.Labels?.["zini.storage"] !== expectedIdentity)) throw new Error("Workspace volume belongs to a different data directory");
  const info = await inspect(name);
  const { removeWorkspaceServices } = await import("./workspaceServices.js");
  await removeWorkspaceServices(issueId, expectedIdentity);
  if (!info) { forgetGitSandbox(workspacePath(issueId)); await removeOwnedResource("volume", `${name}-state`); await removeOwnedResource("network", `${name}-network`); await removeWorkspaceVolume(issueId, expectedIdentity); return; }
  // Validate ownership even for stopped containers before removing anything.
  if (info.Config.Labels?.["zini.owner"] !== owner) throw new Error("Container is not owned by this installation");
  if (info.Config.Labels?.["zini.storage"] !== expectedIdentity) throw new Error("Container belongs to a different data directory");
  if (!info.State.Running) forgetGitSandbox(workspacePath(issueId));
  else registerGitSandbox(workspacePath(issueId), name);
  await trustedGit(workspacePath(issueId), async () => { await docker(["rm", "-f", name]); forgetGitSandbox(workspacePath(issueId)); });
  await removeOwnedResource("volume", `${name}-state`);
  await removeOwnedResource("network", `${name}-network`);
  await removeWorkspaceVolume(issueId, expectedIdentity);
}
