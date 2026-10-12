import { tool } from "langchain";
import { z } from "zod";
import type { ChecksDocument, EnvironmentSetupDocument, ReviewDocument } from "shared";
import { REPO_COMMAND } from "./documents.js";
import { runCommandResult, startProcess, readOutput, stopProcess } from "./qaProcesses.js";
import { workspaceRequest, ensureSandbox } from "../workspaces/workspaceSandbox.js";
import { SERVICE_REQUEST, provisionWorkspaceServices, configureWorkspaceEnvironment, provisionWorkspaceTls } from "../workspaces/workspaceServices.js";

type Result = ChecksDocument["results"][number];
const key = (entry: { command: string; cwd: string }) => `${entry.cwd}\0${entry.command}`;
export class SetupEvidence {
  results: Result[];
  private operations = 0;
  constructor(previous: EnvironmentSetupDocument | null, readonly revision: string, readonly changed = () => {}) {
    this.results = previous?.revision === revision ? [...previous.results] : [];
  }
  budget() {
    if (++this.operations > 32) throw new Error("Preparation operation budget exhausted. Submit blockingQuestions with the remaining blocker or requiredChanges for a code defect.");
  }
  record(result: Result) {
    const index = this.results.findIndex(previous => key(previous) === key(result));
    if (index < 0) this.results.push(result); else this.results[index] = result;
  }
  report(review: ReviewDocument): EnvironmentSetupDocument {
    return { revision: this.revision, complete: !review.blockingQuestions.length && !review.requiredChanges.length,
      results: [...this.results], blockingQuestions: review.blockingQuestions };
  }
}
export function setupTools(id: string, evidence: SetupEvidence) {
  return [
    tool(async ({ bindings }) => {
      evidence.budget(); const result = await provisionWorkspaceTls(id, bindings); evidence.changed(); return result;
    }, { name: "generate_tls_certificates", description: "Generate or reuse a workspace-local development PEM certificate/private key for localhost. Persist outside Git; return paths only. Inject TLS_KEY/TLS_CERT and NODE_EXTRA_CA_CERTS into Reviewer, QA and previews. Optional bindings map repo-specific env names to key/cert paths. Use for local HTTPS; never ask users for their personal development certificates.", schema: z.object({ bindings: z.record(z.string(), z.enum(["key", "cert"])).optional() }) }),
    tool(async ({ services }, config) => {
      evidence.budget(); const result = await provisionWorkspaceServices(id, services, config.signal); evidence.changed(); return result;
    }, { name: "provision_services", description: "Provision or reuse dedicated workspace PostgreSQL/Redis, wait for authenticated health checks, and inject local test connection variables into all commands/app processes. Defaults: PostgreSQL 16, Redis 7. Services persist through retries; never resets data. Use bindings for repo-specific env names. No production credentials are used.", schema: z.object({ services: z.array(SERVICE_REQUEST).min(1).max(2) }) }),
    tool(async ({ values }) => { evidence.budget(); const result = await configureWorkspaceEnvironment(id, values); evidence.changed(); return result; }, {
      name: "configure_environment", description: "Persist repo-specific local test configuration (e.g. NODE_ENV=test) for all workspace commands/apps. Services supply generated connection credentials. Never put production/provider secrets here or invent missing external credentials.", schema: z.object({ values: z.record(z.string(), z.string()).refine(values => Object.keys(values).length <= 32) }),
    }),
    tool(async ({ entry, timeoutSeconds, rerun }, config) => {
      evidence.budget(); if (entry.kind !== "setup") throw new Error("run_setup accepts only setup commands");
      const previous = evidence.results.findLast(result => key(result) === key(entry));
      if (previous?.status === "passed" && !rerun) return { ...previous, reused: true };
      let result: Result;
      try {
        const actual = await runCommandResult(id, entry.command, entry.cwd, timeoutSeconds ?? 300, config.signal);
        result = { command: entry.command, cwd: entry.cwd, purpose: entry.purpose, status: actual.exitCode === 0 && !actual.timedOut ? "passed" : "blocked", exitCode: actual.exitCode, output: `${actual.status}\n${actual.output}` };
      } catch (error) { config.signal?.throwIfAborted(); result = { command: entry.command, cwd: entry.cwd, purpose: entry.purpose, status: "blocked", exitCode: null, output: String(error) }; }
      evidence.record(result); evidence.changed(); return result;
    }, { name: "run_setup", description: "Execute a finite installation, migration, seed or fixture-verification command and observe real output. Successful commands on the current source revision are reused unless rerun is necessary after environment/data changes. Diagnose failures and repair prerequisites; don't repeat failing commands unchanged. No implementation edits, tests, builds or Git mutations.", schema: z.object({ entry: REPO_COMMAND, timeoutSeconds: z.number().int().min(1).max(1800).optional(), rerun: z.boolean().optional() }) }),
    tool(async ({ command, url, timeoutSeconds }, config) => {
      evidence.budget(); const target = new URL(url);
      if (!["http:", "https:"].includes(target.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.port === "7777") throw new Error("Readiness URL must be a local HTTP(S) app endpoint");
      const receipt = `Readiness: ${command} -> ${url}`;
      let process: string | undefined;
      let result: Result = { command: receipt, cwd: ".", purpose: "Application startup and HTTP(S) readiness", status: "blocked", exitCode: null, output: "Not started" };
      try {
        await ensureSandbox(id);
        await workspaceRequest(id, "portFree", { port: Number(target.port || (target.protocol === "https:" ? "443" : "80")) });
        process = await startProcess(id, command); const deadline = Date.now() + (timeoutSeconds ?? 30) * 1000;
        while (true) {
          config.signal?.throwIfAborted();
          const output = await readOutput(id, process);
          if (!output.startsWith(`${process}: running`)) throw new Error(output);
          const response = await workspaceRequest<string>(id, "http", { method: "GET", url }).catch(() => "");
          if (/^2\d\d\b/.test(response)) { result = { ...result, status: "passed", exitCode: 0, output: response }; break; }
          if (Date.now() >= deadline) throw new Error(`Readiness timed out: ${response}\n${output}`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) { config.signal?.throwIfAborted(); result.output = String(error); }
      finally { if (process) await stopProcess(id, process); }
      evidence.record(result); return { receipt, ...result };
    }, { name: "check_app", description: "Start a repo-supported app command at the workspace root, observe startup, require HTTP(S) 2xx readiness, then stop it. Use for backend/live-QA prerequisites. The result is recorded automatically for QA. Choose a free port and a source-supported health URL.", schema: z.object({ command: z.string().min(1), url: z.string(), timeoutSeconds: z.number().int().min(1).max(120).optional() }) }),
  ];
}
