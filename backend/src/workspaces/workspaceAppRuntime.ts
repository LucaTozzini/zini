import { setTimeout as delay } from "node:timers/promises";
import { existingSandbox, ensureSandbox, sandboxPaused, sandboxRequest, workspaceRequest, type Sandbox } from "./workspaceSandbox.js";
import { validateAppLaunchPlan, type AppLaunchPlan } from "./localAppRuntime.js";
import { withWorkspaceLock } from "./workspaceLocks.js";
import { closePreview } from "../browser/previewBrowser.js";
import { workspaceRevision } from "./workspaceFiles.js";
export { validateAppLaunchPlan };
export type { AppLaunchPlan, AppCommand, AppService } from "./localAppRuntime.js";
// The webapp's page showing the ready app in the workspace's remote-controlled browser.
export const previewPage = (issueId: string) => `/issues/${encodeURIComponent(issueId)}/preview`;
export const availableAppPort = async (issueId: string) => workspaceRequest<number>(issueId, "port");
// url is the app's address inside the workspace container, where its preview browser runs.
type Status = { status: "stopped" | "starting" | "ready" | "failed"; url?: string | null; previewUrl?: string | null; error?: string | null; output?: string; plan?: AppLaunchPlan | null };
const withPreview = (issueId: string, state: Status): Status =>
  ({ ...state, previewUrl: state.status === "ready" ? previewPage(issueId) : null });
export class WorkspaceAppRuntime {
  private sessions = new Map<string, { sandbox: Sandbox; state: Status }>();
  private refreshing = new Map<string, Promise<Status>>();
  status(issueId: string): Status { return this.sessions.get(issueId)?.state ?? { status: "stopped" }; }
  starting(issueId: string) { return this.status(issueId).status === "starting"; }
  refresh(issueId: string) {
    let pending = this.refreshing.get(issueId);
    if (!pending) {
      pending = this.refreshSession(issueId).finally(() => this.refreshing.delete(issueId));
      this.refreshing.set(issueId, pending);
    }
    return pending;
  }
  private async refreshSession(issueId: string) {
    try {
      // A container a Git operation paused still runs its app, so it isn't reported
      // stopped (and is never unpaused here): its known gateway's answer waits until the
      // operation resumes it, or without one, the pause is waited out.
      let sandbox: Sandbox | null = null;
      for (let n = 0; n < 40; n++) {
        sandbox = await existingSandbox(issueId);
        if (sandbox) break;
        if (!await sandboxPaused(issueId)) { sandbox = await existingSandbox(issueId); break; }
        sandbox = this.sessions.get(issueId)?.sandbox ?? null;
        if (sandbox) break;
        await delay(250);
      }
      if (!sandbox) { this.sessions.delete(issueId); return this.status(issueId); }
      const state = withPreview(issueId, await sandboxRequest<Status>(sandbox, "appStatus"));
      this.sessions.set(issueId, { sandbox, state }); return state;
    } catch (error) { this.sessions.delete(issueId); throw error; }
  }
  async stop(issueId: string) {
    await closePreview(issueId);
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
        const state = withPreview(issueId, await sandboxRequest<Status>(sandbox, "appLaunch", { plan, timeout: readinessTimeoutMs }, signal));
        this.sessions.set(issueId, { sandbox, state }); return state;
      } catch (error) { await this.stop(issueId); signal?.throwIfAborted(); throw error; }
      finally { signal?.removeEventListener("abort", abort); }
    });
  }
}
