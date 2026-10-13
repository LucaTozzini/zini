import { z } from "zod";
import { existingSandbox, ensureSandbox, sandboxRequest, workspaceRequest } from "../workspaces/workspaceSandbox.js";

// The agents' finite commands are stopped after this long without output: nothing can
// answer a prompt, so a silent command is probably waiting for input.
export const QUIET_SECONDS = 120;
export const quietSeconds = z.number().int().min(10).max(1800).optional()
  .describe(`Stop the command after this many seconds without output (default ${QUIET_SECONDS}); raise it only for a command that's legitimately silent that long`);

// quietSeconds stops the command after that long without output (see QUIET_SECONDS).
export async function runCommandResult(issueId: string, command: string, cwd = ".", timeoutSeconds?: number, signal?: AbortSignal, quietSeconds?: number) {
  signal?.throwIfAborted();
  const sandbox = await ensureSandbox(issueId);
  const id = await sandboxRequest<string>(sandbox, "start", { command, cwd, timeout: timeoutSeconds, quiet: quietSeconds });
  try {
    while (true) {
      signal?.throwIfAborted();
      const result = await sandboxRequest<{ exitCode: number | null; timedOut: boolean; status: string; output: string }>(sandbox, "result", { id }, signal);
      if (result.status !== "running") return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally { await sandboxRequest(sandbox, "stop", { id }); }
}
export async function runCommand(issueId: string, command: string, timeoutSeconds?: number, signal?: AbortSignal, quietSeconds?: number) {
  const result = await runCommandResult(issueId, command, ".", timeoutSeconds, signal, quietSeconds); return `${result.status}\n\n${result.output}`;
}
export const startProcess = (issueId: string, command: string) => workspaceRequest<string>(issueId, "start", { command });
export const readOutput = (issueId: string, id: string) => workspaceRequest<string>(issueId, "read", { id });
export const stopProcess = (issueId: string, id: string) => workspaceRequest<string>(issueId, "stop", { id });
export async function stopAllProcesses(issueId: string) {
  const sandbox = await existingSandbox(issueId); if (sandbox) await sandboxRequest(sandbox, "drain");
}
export const drainProcesses = stopAllProcesses;
