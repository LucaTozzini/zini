import { tool } from "langchain";
import { z } from "zod";
import { readOutput, runCommand, startProcess, stopProcess } from "./qaProcesses.js";

// The QA's tools for running the software in the issue's workspace: commands (each one
// approved by the user first; see the QA's humanInTheLoopMiddleware), HTTP requests and
// a browser, both only to this machine.

// The tools that run something on this machine, so need the user's approval.
export const COMMAND_TOOLS = ["run_command", "start_process"] as const;

// What a model is given of a response or page, at most.
const MAX_TEXT = 8_000;
const cut = (text: string) =>
  text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}\n[Cut off: ${text.length - MAX_TEXT} more characters]`;

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

export function commandTools(issueId: string, { productOnly = false, completedChecks = [] }: { productOnly?: boolean; completedChecks?: string[] } = {}) {
  return [
    tool(async ({ command, timeoutSeconds }, config) => {
      if (productOnly && completedChecks.some((check) => check.trim() === command.trim()))
        throw new Error("This deterministic check already has recorded results. Use that evidence and exercise product behavior instead.");
      return runCommand(issueId, command, timeoutSeconds, config.signal);
    }, {
      name: "run_command",
      description:
        (productOnly ? "Use only to exercise the delivered CLI/library interface or recover missing runtime prerequisites. Deterministic checks have already run. " : "") +
        "Run a shell command in the workspace folder and wait for it to finish: its exit " +
        "code and the end of its output. For installs, builds, linters and tests; start " +
        "servers with start_process instead. The user approves each command first.",
      schema: z.object({
        command: z.string().min(1),
        timeoutSeconds: z
          .number()
          .int()
          .min(1)
          .max(1800)
          .optional()
          .describe("Stop it after this long (default 300)"),
      }),
    }),
    tool(async ({ command }) => `Started ${startProcess(issueId, command)}: read its output with read_output.`, {
      name: "start_process",
      description:
        "Start a long-running shell command in the workspace folder (e.g. a dev server) " +
        "and leave it running; returns its id. It's stopped when your run ends. The user " +
        "approves each command first.",
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
        const response = await fetch(localUrl(url), {
          method,
          headers,
          body: body ?? undefined,
          // A redirect elsewhere isn't followed.
          redirect: "manual",
          signal: AbortSignal.timeout(30_000),
        });
        const type = response.headers.get("content-type") ?? "unknown";
        const location = response.headers.get("location");
        return [
          `${response.status} ${response.statusText}`,
          `Content-Type: ${type}`,
          location ? `Location: ${location}` : "",
          "",
          cut(await response.text()) || "(empty body)",
        ]
          .filter((line, i) => line || i === 3)
          .join("\n");
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
