import { existingSandbox, ensureSandbox, sandboxRequest, workspaceRequest } from "../workspaces/workspaceSandbox.js";
export async function runCommandResult(issueId: string, command: string, cwd = ".", timeoutSeconds?: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const sandbox = await ensureSandbox(issueId);
  const id = await sandboxRequest<string>(sandbox, "start", { command, cwd, timeout: timeoutSeconds });
  try {
    while (true) {
      signal?.throwIfAborted();
      const result = await sandboxRequest<{ exitCode: number | null; timedOut: boolean; status: string; output: string }>(sandbox, "result", { id }, signal);
      if (result.status !== "running") return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally { await sandboxRequest(sandbox, "stop", { id }); }
}
export async function runCommand(issueId: string, command: string, timeoutSeconds?: number, signal?: AbortSignal) {
  const result = await runCommandResult(issueId, command, ".", timeoutSeconds, signal); return `${result.status}\n\n${result.output}`;
}
export const startProcess = (issueId: string, command: string) => workspaceRequest<string>(issueId, "start", { command });
export const readOutput = (issueId: string, id: string) => workspaceRequest<string>(issueId, "read", { id });
export const stopProcess = (issueId: string, id: string) => workspaceRequest<string>(issueId, "stop", { id });
export async function stopAllProcesses(issueId: string) {
  const sandbox = await existingSandbox(issueId); if (sandbox) await sandboxRequest(sandbox, "drain");
}
export const drainProcesses = stopAllProcesses;
