import { tool } from "langchain";
import { z } from "zod";
import { QUIET_SECONDS, quietSeconds, readOutput, runCommand, startProcess, stopProcess } from "./qaProcesses.js";
import { workspaceRequest } from "../workspaces/workspaceSandbox.js";

// Commands, HTTP requests and the browser use the isolated Docker workspace.

// Only this machine: the QA tests the app it started, not services elsewhere.
function localUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${value} isn't a URL: give the whole address, e.g. http://localhost:3000/`);
  }
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Only http(s) addresses on this machine (localhost, 127.0.0.1, [::1]) can be used");
  }
  return url;
}

export function commandTools(
  issueId: string,
  { productOnly = false, completedChecks = [] }: { productOnly?: boolean; completedChecks?: string[] } = {},
) {
  return [
    tool(
      async ({ command, timeoutSeconds, quietSeconds }, config) => {
        if (productOnly && completedChecks.some((check) => check.trim() === command.trim()))
          throw new Error(
            "This deterministic check already has recorded results. Use that evidence and exercise product behavior instead.",
          );
        return runCommand(issueId, command, timeoutSeconds, config.signal, quietSeconds ?? QUIET_SECONDS);
      },
      {
        name: "run_command",
        description:
          (productOnly
            ? "Use only to exercise the delivered CLI/library interface and diagnose runtime failures. Reviewer already ran deterministic checks. Report environment blockers to Reviewer using environmentFailures. "
            : "For installs, builds, linters and tests. ") +
          "Run a shell command in the workspace folder and wait for it to finish: its exit " +
          "code and the end of its output. Start " +
          "servers with start_process instead. Commands execute inside the Docker workspace.",
        schema: z.object({
          command: z.string().min(1),
          timeoutSeconds: z
            .number()
            .int()
            .min(1)
            .max(1800)
            .optional()
            .describe("Optional time limit in seconds. Omit to run until completion or cancellation."),
          quietSeconds,
        }),
      },
    ),
    tool(async ({ command }) => `Started ${await startProcess(issueId, command)}: read its output with read_output.`, {
      name: "start_process",
      description:
        "Start a long-running shell command in the workspace folder (e.g. a dev server) " +
        "and leave it running inside Docker; returns its id. It's stopped when your run ends.",
      schema: z.object({ command: z.string().min(1) }),
    }),
    tool(async ({ id }) => readOutput(issueId, id), {
      name: "read_output",
      description:
        "What a process from start_process printed since the last read, and whether it's " +
        "still running. Call again to wait for more (e.g. until a server says it's ready).",
      schema: z.object({ id: z.string() }),
    }),
    tool(async ({ id }) => stopProcess(issueId, id), {
      name: "stop_process",
      description: "Stop a process from start_process, and everything it started.",
      schema: z.object({ id: z.string() }),
    }),
    tool(
      async ({ method, url, headers, body }) => {
        return workspaceRequest<string>(issueId, "http", { method, url: localUrl(url).href, headers, body });
      },
      {
        name: "http_request",
        description:
          "Send an HTTP request to a server on this machine (localhost) and get its status, " +
          "content type and body. Redirects aren't followed.",
        schema: z.object({
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
          url: z.string().describe('e.g. "http://localhost:3000/api/health"'),
          headers: z.record(z.string(), z.string()).optional(),
          body: z.string().optional().describe("e.g. JSON, with a Content-Type header"),
        }),
      },
    ),
  ];
}

export { browserTools } from "../browser/browserTools.js";
