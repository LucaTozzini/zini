import type { ChildProcess } from "node:child_process";
import { createServer, connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { killTree, spawnShell } from "./processes.js";

export type AppCommand = { command: string; cwd: string };
export type AppService = AppCommand & { id: string; port: number; readiness: "http" | "tcp"; path: string };
export type PreviewRoute = { prefix: string; serviceId: string; stripPrefix: boolean };
export type AppLaunchPlan = { setup: AppCommand[]; services: AppService[];
  app: { serviceId: string; path: string; preservePreviewPath?: boolean }; routes?: PreviewRoute[] };
export const previewBase = (issueId: string) => `/preview/${encodeURIComponent(issueId)}`;
type Session = {
  status: "starting" | "ready" | "failed";
  url: string;
  error: string | null;
  output: string;
  children: Set<ChildProcess>;
  plan: AppLaunchPlan;
};

export async function availableAppPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function portIsFree(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new Error(`Port ${port} is already in use. Inspect again and select another port.`)));
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function localPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path))
    throw new Error("App and readiness paths must be local paths beginning with /.");
  return path;
}

export function validateAppLaunchPlan(plan: AppLaunchPlan) {
  const ids = new Set<string>();
  const ports = new Set<number>();
  if (!plan.services.length) throw new Error("A web app needs at least one service.");
  for (const service of plan.services) {
    if (ids.has(service.id) || ports.has(service.port)) throw new Error("Service IDs and ports must be unique.");
    ids.add(service.id); ports.add(service.port);
    localPath(service.path);
  }
  if (!ids.has(plan.app.serviceId)) throw new Error("The app must refer to a declared service.");
  if (plan.services.find((service) => service.id === plan.app.serviceId)?.readiness !== "http")
    throw new Error("The browser-facing service must use HTTP readiness.");
  localPath(plan.app.path);
  const prefixes = new Set<string>();
  for (const route of plan.routes ?? []) {
    localPath(route.prefix);
    if (route.prefix === "/" || /[?#%]/.test(route.prefix) || route.prefix.endsWith("/") || prefixes.has(route.prefix))
      throw new Error("Preview route prefixes must be unique paths without trailing slashes, queries or fragments.");
    prefixes.add(route.prefix);
    if (plan.services.find((service) => service.id === route.serviceId)?.readiness !== "http")
      throw new Error("Preview routes must refer to declared HTTP services.");
  }
}

async function isReady(service: AppService) {
  if (service.readiness === "tcp") {
    return new Promise<boolean>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port: service.port });
      const finish = (ready: boolean) => { socket.destroy(); resolve(ready); };
      socket.setTimeout(1000);
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.once("timeout", () => finish(false));
    });
  }
  try {
    const response = await fetch(`http://127.0.0.1:${service.port}${service.path}`, {
      redirect: "manual", signal: AbortSignal.timeout(1000),
    });
    await response.body?.cancel();
    return response.status >= 200 && response.status < 400 || response.status === 401 || response.status === 403;
  } catch { return false; }
}

// User launch sessions own their processes independently of coordinator/QA cleanup.
// Sessions last until stopped, fail, or the backend exits; they are not checkpoints.
export class WorkspaceAppRuntime {
  private sessions = new Map<string, Session>();
  constructor(private cwd: (issueId: string, cwd: string) => Promise<string>) {}

  status(issueId: string) {
    const session = this.sessions.get(issueId);
    if (!session) return { status: "stopped" as const };
    return { status: session.status, url: session.status === "ready" ? session.url : null,
      previewUrl: session.status === "ready" ? `${previewBase(issueId)}${session.plan.app.path}` : null,
      error: session.error, output: session.output.slice(-8000) };
  }

  starting(issueId: string) { return this.sessions.get(issueId)?.status === "starting"; }

  // Only an active, ready session's declared HTTP services can be reached by the proxy.
  previewTarget(issueId: string, path: string) {
    const session = this.sessions.get(issueId);
    if (session?.status !== "ready") return null;
    const plan = session.plan;
    const pathname = path.split("?")[0]!;
    const route = [...(plan.routes ?? [])].sort((a, b) => b.prefix.length - a.prefix.length)
      .find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
    const service = plan.services.find((entry) => entry.id === (route?.serviceId ?? plan.app.serviceId))!;
    let upstreamPath = path;
    if (route?.stripPrefix) upstreamPath = path.slice(route.prefix.length) || "/";
    if (upstreamPath.startsWith("?")) upstreamPath = `/${upstreamPath}`;
    if (!route && plan.app.preservePreviewPath) upstreamPath = `${previewBase(issueId)}${path}`;
    return { port: service.port, path: upstreamPath, prefix: route?.prefix ?? "", stripPrefix: route?.stripPrefix ?? false };
  }

  async stop(issueId: string) {
    const session = this.sessions.get(issueId);
    this.sessions.delete(issueId);
    if (session) await Promise.all([...session.children].map((child) => {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out stopping the app process.")), 10_000);
        child.once("close", () => { clearTimeout(timer); resolve(); });
        killTree(child);
      });
    }));
    return { status: "stopped" as const };
  }

  async stopAll() { await Promise.all([...this.sessions.keys()].map((issueId) => this.stop(issueId))); }

  async launch(issueId: string, plan: AppLaunchPlan, signal?: AbortSignal, readinessTimeoutMs = 60_000) {
    signal?.throwIfAborted();
    const existing = this.sessions.get(issueId);
    if (existing && existing.status !== "failed") return this.status(issueId);
    validateAppLaunchPlan(plan);
    const appService = plan.services.find((service) => service.id === plan.app.serviceId)!;
    const session: Session = { status: "starting", url: `http://127.0.0.1:${appService.port}${plan.app.preservePreviewPath ? previewBase(issueId) : ""}${plan.app.path}`,
      error: null, output: "", children: new Set(), plan };
    this.sessions.set(issueId, session);
    const append = (text: string) => { session.output = (session.output + text).slice(-200_000); };
    const fail = (error: string) => {
      session.status = "failed"; session.error = error;
      for (const child of session.children) killTree(child);
    };
    const abort = () => fail("Launch cancelled.");
    signal?.addEventListener("abort", abort, { once: true });
    const spawn = async (entry: AppCommand) => {
      const directory = await this.cwd(issueId, entry.cwd);
      signal?.throwIfAborted();
      if (this.sessions.get(issueId) !== session || session.status === "failed") throw new Error("Launch stopped.");
      append(`\n[${entry.cwd}] $ ${entry.command}\n`);
      const child = spawnShell(entry.command, directory, { FORCE_COLOR: "0", NO_COLOR: "1" });
      session.children.add(child);
      child.stdout?.on("data", (chunk) => append(chunk.toString()));
      child.stderr?.on("data", (chunk) => append(chunk.toString()));
      return child;
    };
    try {
      // Check before installation so a conflicting app is never reported as ours.
      for (const service of plan.services) await portIsFree(service.port);
      for (const entry of plan.setup) {
        const child = await spawn(entry);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { killTree(child); reject(new Error(`Setup timed out: ${entry.command}`)); }, 300_000);
          const finish = (error?: Error) => {
            clearTimeout(timer); session.children.delete(child);
            error ? reject(error) : resolve();
          };
          child.once("error", finish);
          child.once("close", (code) => finish(code === 0 ? undefined : new Error(`Setup exited with code ${code}: ${entry.command}`)));
        });
        signal?.throwIfAborted();
      }
      for (const service of plan.services) {
        const child = await spawn(service);
        child.once("error", (error) => fail(`${service.id}: ${error.message}`));
        child.once("close", (code) => {
          session.children.delete(child);
          if (this.sessions.get(issueId) === session && session.status !== "failed")
            fail(`${service.id} exited with code ${code}.`);
        });
        const deadline = Date.now() + readinessTimeoutMs;
        while (!(await isReady(service))) {
          signal?.throwIfAborted();
          if (session.status === "failed" || this.sessions.get(issueId) !== session) throw new Error(session.error ?? "Launch stopped.");
          if (Date.now() >= deadline) throw new Error(`${service.id} was not ready within ${readinessTimeoutMs / 1000}s.`);
          await delay(250, undefined, { signal });
        }
      }
      if (session.status === "failed" || this.sessions.get(issueId) !== session) throw new Error(session.error ?? "Launch stopped.");
      session.status = "ready";
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      signal?.throwIfAborted();
    } finally { signal?.removeEventListener("abort", abort); }
    return this.status(issueId);
  }
}
