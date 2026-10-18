import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { storage } from "../db.js";
import { docker } from "./docker.js";
import { ensureSandbox, sandboxRequest, type Sandbox } from "./workspaceSandbox.js";
import { sandboxName, sandboxOwner, workspaceIdentity, ownedResource, removeOwnedResource } from "./workspaceVolumes.js";
import { withWorkspaceLock } from "./workspaceLocks.js";
import { activeDevelopmentEnvironment } from "../core/developmentEnvironment.js";

const field = z.enum(["host", "port", "database", "user", "password", "url"]);
export const SERVICE_REQUEST = z.object({
  kind: z.enum(["postgres", "redis"]),
  version: z.enum(["16", "17", "7"]).optional(),
  bindings: z
    .record(z.string(), field)
    .optional()
    .describe("Map repo environment names to connection fields, e.g. DB_NAME: database"),
});
type Request = z.infer<typeof SERVICE_REQUEST>;
type Service = { kind: Request["kind"]; version: string; password: string; bindings?: Request["bindings"] };
type Configuration = { services: Service[]; environment: Record<string, string>; tls?: Record<string, string> };
const folder = resolve(dirname(storage), "workspace-services");
const configured = new Map<string, string>();
const file = (id: string) => join(folder, `${sandboxName(id)}.json`);
const name = (id: string, kind: string) => `${sandboxName(id)}-${kind}`;
async function load(id: string): Promise<Configuration> {
  try {
    return JSON.parse(await readFile(file(id), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { services: [], environment: {} };
    throw error;
  }
}
async function save(id: string, config: Configuration) {
  await mkdir(folder, { recursive: true });
  const temporary = `${file(id)}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(config), { mode: 0o600 });
  await rename(temporary, file(id));
  configured.delete(id);
}
export function validateEnvironment(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    if (
      !/^[A-Z][A-Z0-9_]{0,79}$/.test(key) ||
      /^(PATH|HOME|SHELL|BASH_ENV|ENV|LD_.*|NODE_OPTIONS|NODE_PATH|PLAYWRIGHT_.*|GIT_.*|WORKSPACE_.*)$/.test(key)
    )
      throw new Error(`Reserved or invalid environment variable: ${key}`);
    if (value.length > 4096 || value.includes("\0")) throw new Error(`Invalid environment value for ${key}`);
  }
}
async function inspect(id: string, kind: string, identity = workspaceIdentity) {
  let info;
  try {
    info = JSON.parse(await docker(["inspect", name(id, kind)]))[0];
  } catch (error) {
    if (/No such/i.test(String((error as { stderr?: string }).stderr))) return null;
    throw error;
  }
  if (
    info.Config.Labels?.["zini.owner"] !== sandboxOwner ||
    info.Config.Labels?.["zini.storage"] !== identity ||
    info.Config.Labels?.["zini.workspace"] !== id
  )
    throw new Error("Service container belongs to another workspace or installation");
  return info;
}
function connection(id: string, service: Service) {
  const host = service.kind;
  const port = service.kind === "postgres" ? "5432" : "6379";
  return {
    host,
    port,
    user: service.kind === "postgres" ? "zini" : "default",
    database: service.kind === "postgres" ? "zini_test" : "0",
    password: service.password,
    url:
      service.kind === "postgres"
        ? `postgresql://zini:${service.password}@${host}:${port}/zini_test`
        : `redis://:${service.password}@${host}:${port}/0`,
  };
}
async function healthy(id: string, service: Service) {
  if (service.kind === "postgres") {
    const output = await docker([
      "exec",
      "-e",
      `PGPASSWORD=${service.password}`,
      name(id, service.kind),
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "zini",
      "-d",
      "zini_test",
      "-tAc",
      "SELECT 1",
    ]);
    if (output.trim() !== "1") throw new Error("PostgreSQL query did not succeed");
  } else {
    const output = await docker(["exec", "-e", `REDISCLI_AUTH=${service.password}`, name(id, service.kind), "redis-cli", "PING"]);
    if (output.trim() !== "PONG") throw new Error("Redis PING did not succeed");
  }
}
async function startService(id: string, service: Service, signal?: AbortSignal) {
  const container = name(id, service.kind);
  const volume = `${container}-data`;
  const labels = { "zini.workspace": id, "zini.storage": workspaceIdentity };
  await ownedResource("volume", volume, labels);
  const existing = await inspect(id, service.kind);
  if (existing) {
    if (existing.Config.Image !== `${service.kind}:${service.version}-alpine`)
      throw new Error("Service version changed; recreate the workspace to change versions without losing data unexpectedly");
    if (!existing.State.Running) await docker(["start", container]);
  } else {
    try {
      await docker(["image", "inspect", `${service.kind}:${service.version}-alpine`]);
    } catch {
      await docker(["pull", `${service.kind}:${service.version}-alpine`]);
    }
    await docker([
      "run",
      "-d",
      "--name",
      container,
      "--restart",
      "unless-stopped",
      "--network",
      `${sandboxName(id)}-network`,
      "--network-alias",
      service.kind,
      "--label",
      `zini.owner=${sandboxOwner}`,
      ...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
      "--cpus",
      "1",
      "--memory",
      "512m",
      "--pids-limit",
      "128",
      "--security-opt",
      "no-new-privileges",
      "--mount",
      `type=volume,source=${volume},target=${service.kind === "postgres" ? "/var/lib/postgresql/data" : "/data"}`,
      ...(service.kind === "postgres"
        ? ["-e", "POSTGRES_USER=zini", "-e", "POSTGRES_DB=zini_test", "-e", `POSTGRES_PASSWORD=${service.password}`]
        : []),
      `${service.kind}:${service.version}-alpine`,
      ...(service.kind === "redis" ? ["redis-server", "--appendonly", "yes", "--requirepass", service.password] : []),
    ]);
  }
  const deadline = Date.now() + 60_000;
  while (true) {
    signal?.throwIfAborted();
    try {
      await healthy(id, service);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(`Service ${service.kind} did not become ready: ${String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Only service IPs/ports owned by this workspace bypass the private-network firewall.
export async function restoreWorkspaceServices(id: string, sandbox: Sandbox) {
  const config = await load(id);
  const development = await activeDevelopmentEnvironment();
  const values = { ...config.environment, ...development };
  for (const service of config.services) {
    const fields = connection(id, service);
    const defaults =
      service.kind === "postgres"
        ? {
            DATABASE_URL: fields.url,
            PGHOST: fields.host,
            PGPORT: fields.port,
            PGUSER: fields.user,
            PGPASSWORD: fields.password,
            PGDATABASE: fields.database,
          }
        : { REDIS_URL: fields.url, REDIS_HOST: fields.host, REDIS_PORT: fields.port, REDIS_PASSWORD: fields.password };
    Object.assign(values, defaults);
    for (const [name, field] of Object.entries(service.bindings ?? {})) values[name] = fields[field];
  }
  Object.assign(values, config.tls);
  const signature = `${sandbox.generation}:${sandbox.token}:${JSON.stringify({ config, values })}`;
  if (configured.get(id) === signature) return Object.keys(values);
  for (const service of config.services) {
    const info = await inspect(id, service.kind);
    if (!info?.State.Running) continue; // A provisioning retry can finish or restart a service.
    const ip = info.NetworkSettings.Networks[`${sandboxName(id)}-network`]?.IPAddress;
    if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error("Service has no workspace network address");
    const rule = ["OUTPUT", "-d", ip, "-p", "tcp", "--dport", connection(id, service).port, "-j", "ACCEPT"];
    try {
      await docker(["exec", "--user", "0", sandbox.name, "iptables", "-C", ...rule]);
    } catch {
      await docker(["exec", "--user", "0", sandbox.name, "iptables", "-I", "OUTPUT", "2", ...rule.slice(1)]);
    }
  }
  validateEnvironment(values);
  await sandboxRequest(sandbox, "environment", { values });
  configured.set(id, signature);
  return Object.keys(values);
}
export async function provisionWorkspaceServices(id: string, requests: Request[], signal?: AbortSignal) {
  return withWorkspaceLock(id, async () => {
    const sandbox = await ensureSandbox(id);
    const config = await load(id);
    for (const request of requests) {
      const version =
        request.version ??
        config.services.find((service) => service.kind === request.kind)?.version ??
        (request.kind === "postgres" ? "16" : "7");
      if (!(request.kind === "postgres" ? ["16", "17"] : ["7"]).includes(version))
        throw new Error(`Unsupported ${request.kind} version`);
      let service = config.services.find((service) => service.kind === request.kind);
      if (service && service.version !== version) throw new Error("Service version differs from the existing workspace service");
      if (!service) {
        service = { kind: request.kind, version, password: randomBytes(24).toString("hex") };
        config.services.push(service);
      }
      service.bindings = { ...service.bindings, ...request.bindings };
      validateEnvironment(Object.fromEntries(Object.keys(service.bindings).map((name) => [name, ""])));
      await save(id, config); // Test credentials survive crashes and retries.
      await startService(id, service, signal);
    }
    const environmentVariables = await restoreWorkspaceServices(id, sandbox);
    return {
      services: config.services.map((service) => ({ kind: service.kind, version: service.version, healthy: true })),
      environmentVariables,
    };
  });
}
export async function configureWorkspaceEnvironment(id: string, values: Record<string, string>) {
  validateEnvironment(values);
  const development = await activeDevelopmentEnvironment();
  for (const name of Object.keys(values))
    if (name in development) throw new Error(`${name} is managed in Settings → Development environment variables`);
  return withWorkspaceLock(id, async () => {
    const sandbox = await ensureSandbox(id);
    const config = await load(id);
    Object.assign(config.environment, values);
    await save(id, config);
    await restoreWorkspaceServices(id, sandbox);
    return { environmentVariables: Object.keys(config.environment) };
  });
}
export async function provisionWorkspaceTls(id: string, bindings: Record<string, "key" | "cert"> = {}) {
  validateEnvironment(Object.fromEntries(Object.keys(bindings).map((name) => [name, ""])));
  return withWorkspaceLock(id, async () => {
    const sandbox = await ensureSandbox(id);
    const paths = await sandboxRequest<{ key: string; cert: string; reused: boolean }>(sandbox, "generateTls");
    const config = await load(id);
    config.tls = { ...config.tls, TLS_KEY: paths.key, TLS_CERT: paths.cert, NODE_EXTRA_CA_CERTS: paths.cert };
    for (const [name, field] of Object.entries(bindings)) config.tls[name] = paths[field];
    await save(id, config);
    await restoreWorkspaceServices(id, sandbox);
    return { ...paths, environmentVariables: Object.keys(config.tls) };
  });
}
export async function workspaceServiceHealth(id: string) {
  const config = await load(id);
  for (const service of config.services) {
    const info = await inspect(id, service.kind);
    if (!info?.State.Running) throw new Error(`Workspace ${service.kind} is unavailable; provision_services can restart it`);
    await healthy(id, service);
  }
  return config.services.map((service) => ({ kind: service.kind, version: service.version, healthy: true }));
}
export async function removeWorkspaceServices(id: string, identity = workspaceIdentity) {
  for (const kind of ["postgres", "redis"]) {
    if (await inspect(id, kind, identity)) await docker(["rm", "-f", name(id, kind)]);
    const volume = `${name(id, kind)}-data`;
    const { resource } = await import("./workspaceVolumes.js");
    const info = await resource("volume", volume);
    if (info && info.Labels?.["zini.storage"] !== identity) throw new Error("Service volume belongs to another installation");
    await removeOwnedResource("volume", volume);
  }
  await rm(file(id), { force: true });
  configured.delete(id);
}
