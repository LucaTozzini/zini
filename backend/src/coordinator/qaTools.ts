import { tool } from "langchain";
import type { Page } from "playwright";
import { z } from "zod";
import { getPage, noteUrl } from "./qaBrowser.js";
import { readOutput, runCommand, startProcess, stopProcess } from "./qaProcesses.js";

// The QA's tools for running the software in the issue's workspace: commands (each one
// approved by the user first; see the QA's humanInTheLoopMiddleware), HTTP requests and
// a browser, both only to this machine.

// The tools that run something on this machine, so need the user's approval.
export const COMMAND_TOOLS = ["run_command", "start_process"] as const;

// How long a page gets after a browser step before it's read.
const SETTLE_MS = 500;

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

export function commandTools(issueId: string) {
  return [
    tool(async ({ command, timeoutSeconds }) => runCommand(issueId, command, timeoutSeconds), {
      name: "run_command",
      description:
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

// What the page shows, as its accessibility tree: roles, names and text.
async function snapshot(page: Page) {
  const title = await page.title().catch(() => "");
  const tree = await page.locator("body").ariaSnapshot({ timeout: 10_000 });
  return cut(`${page.url()}${title ? ` (${title})` : ""}\n\n${tree}`);
}

const TARGET = {
  role: z.string().optional().describe('An ARIA role from the snapshot, e.g. "button", "textbox", "link"'),
  name: z.string().optional().describe("Its name, as the snapshot shows it in quotes"),
  selector: z.string().optional().describe("A CSS selector, when role and name don't single it out"),
};

function locate(page: Page, { role, name, selector }: { role?: string; name?: string; selector?: string }) {
  if (selector) return page.locator(selector);
  if (!role) throw new Error("Give a role (with its name), or a selector");
  return page.getByRole(role as Parameters<Page["getByRole"]>[0], name ? { name, exact: true } : {});
}

// A Playwright error's message without its color codes and the "Call log" after it,
// e.g. "locator.fill: Timeout 10000ms exceeded."
function playwrightError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const [first = ""] = message.replace(/\x1b\[[0-9;]*m/g, "").split(/\n\s*Call log:/);
  return first.trim();
}

// notify runs after each step, so the webapp shows where the browser is.
export function browserTools(issueId: string, notify: () => void) {
  // Runs a step on the page, then answers with what the page shows.
  const onPage = (step: (page: Page) => Promise<unknown>) => async () => {
    const { page } = await getPage(issueId);
    try {
      await step(page).catch((err) => {
        throw new Error(playwrightError(err));
      });
      // Whatever the step set off gets a moment to land: a navigation, and what the page
      // updates just after (e.g. a label that changes once a copy or request finishes).
      await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(SETTLE_MS);
      return await snapshot(page);
    } finally {
      noteUrl(issueId, page);
      notify();
    }
  };
  return [
    tool(({ url }) => onPage((page) => page.goto(localUrl(url).href, { timeout: 30_000 }))(), {
      name: "browser_open",
      description:
        "Open a page on this machine (localhost) in your browser; returns what it shows " +
        "(its accessibility tree). The user can watch the browser live.",
      schema: z.object({ url: z.string().describe('e.g. "http://localhost:5173/"') }),
    }),
    tool(() => onPage(async () => {})(), {
      name: "browser_snapshot",
      description: "What the page in your browser shows now, as its accessibility tree.",
      schema: z.object({}),
    }),
    tool((target) => onPage((page) => locate(page, target).click({ timeout: 10_000 }))(), {
      name: "browser_click",
      description:
        "Click an element, by its role and name from the snapshot (or a CSS selector); " +
        "returns what the page shows after.",
      schema: z.object(TARGET),
    }),
    tool(
      ({ text, submit, ...target }) =>
        onPage(async (page) => {
          const field = locate(page, target);
          await field.fill(text, { timeout: 10_000 });
          if (submit) await field.press("Enter");
        })(),
      {
        name: "browser_type",
        description:
          "Fill a field with text, replacing what's in it, by its role and name from the " +
          "snapshot (or a CSS selector); submit presses Enter after. Returns what the page " +
          "shows after.",
        schema: z.object({ ...TARGET, text: z.string(), submit: z.boolean().optional() }),
      },
    ),
    tool(
      async () => {
        const { page } = await getPage(issueId);
        // As a string: it runs in the page, and the backend has no browser types.
        const text = String(
          await page.evaluate("navigator.clipboard.readText()").catch((err) => {
            throw new Error(`Couldn't read the clipboard: ${playwrightError(err)}`);
          }),
        );
        return text ? `The clipboard holds:\n${cut(text)}` : "The clipboard is empty.";
      },
      {
        name: "browser_clipboard",
        description:
          "The text on your browser's clipboard, e.g. to check what a copy button copied. " +
          "Read it with a page of the app open.",
        schema: z.object({}),
      },
    ),
    tool(
      async () => {
        const { console: pageConsole } = await getPage(issueId);
        const lines = pageConsole.splice(0);
        return lines.length ? cut(lines.join("\n")) : "Nothing since the last read.";
      },
      {
        name: "browser_console",
        description:
          "Console errors and warnings, uncaught errors and failed or 4xx/5xx requests in " +
          "your browser since the last read.",
        schema: z.object({}),
      },
    ),
  ];
}
