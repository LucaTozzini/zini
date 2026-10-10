import { existingSandbox, ensureSandbox, sandboxRequest, workspaceRequest, type Sandbox } from "./workspaceSandbox.js";
import { previewBase, validateAppLaunchPlan, type AppLaunchPlan } from "./localAppRuntime.js";
import { withWorkspaceLock } from "./workspaceLocks.js";
import { workspaceRevision } from "./workspaceFiles.js";
export { previewBase, validateAppLaunchPlan };
export type { AppLaunchPlan, AppCommand, AppService, PreviewRoute } from "./localAppRuntime.js";
export const availableAppPort = async (issueId: string) => workspaceRequest<number>(issueId, "port");
type Status = { status: "stopped" | "starting" | "ready" | "failed"; url?: string | null; previewUrl?: string | null; error?: string | null; output?: string; plan?: AppLaunchPlan | null };
export class WorkspaceAppRuntime {
  private sessions = new Map<string, { sandbox: Sandbox; state: Status }>();
  status(issueId: string): Status { return this.sessions.get(issueId)?.state ?? { status: "stopped" }; }
  starting(issueId: string) { return this.status(issueId).status === "starting"; }
  async refresh(issueId: string) {
    try {
      const sandbox = await existingSandbox(issueId);
      if (!sandbox) { this.sessions.delete(issueId); return this.status(issueId); }
      const state = await sandboxRequest<Status>(sandbox, "appStatus");
      this.sessions.set(issueId, { sandbox, state }); return state;
    } catch (error) { this.sessions.delete(issueId); throw error; }
  }
  previewTarget(issueId: string, path: string) {
    const session = this.sessions.get(issueId); const plan = session?.state.plan;
    if (!session || session.state.status !== "ready" || !plan) return null;
    const pathname = path.split("?")[0]!;
    const route = [...(plan.routes ?? [])].sort((a,b) => b.prefix.length-a.prefix.length).find(entry => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
    const service = plan.services.find(entry => entry.id === (route?.serviceId ?? plan.app.serviceId))!;
    return { port: session.sandbox.port, servicePort: service.port, path, transportPath: `${previewBase(issueId)}${path}`,
      token: session.sandbox.token, prefix: route?.prefix ?? "", stripPrefix: route?.stripPrefix ?? false };
  }
  async stop(issueId: string) {
    const sandbox = await existingSandbox(issueId);
    if (sandbox) await sandboxRequest(sandbox, "appStop");
    this.sessions.delete(issueId); return { status: "stopped" as const };
  }
  async stopAll() { await Promise.all([...this.sessions.keys()].map(issue => this.stop(issue))); }
  async launch(issueId: string, plan: AppLaunchPlan, signal?: AbortSignal, readinessTimeoutMs = 60000, revision?: string) {
    validateAppLaunchPlan(plan); signal?.throwIfAborted();
    const sandbox = await ensureSandbox(issueId);
    return withWorkspaceLock(issueId, async () => {
      if (revision && await workspaceRevision(issueId) !== revision) throw new Error("Workspace changed since inspection. Read the changed files and propose a fresh plan.");
      const current = await this.refresh(issueId);
      if (current.status === "ready" || current.status === "starting") return current;
      this.sessions.set(issueId, { sandbox, state: { status: "starting", plan } });
      const abort = () => { void sandboxRequest(sandbox, "appStop").catch(() => {}); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const state = await sandboxRequest<Status>(sandbox, "appLaunch", { plan, timeout: readinessTimeoutMs }, signal);
        this.sessions.set(issueId, { sandbox, state }); return state;
      } catch (error) { await this.stop(issueId); signal?.throwIfAborted(); throw error; }
      finally { signal?.removeEventListener("abort", abort); }
    });
  }
}
