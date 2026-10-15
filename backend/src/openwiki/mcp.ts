// Central OpenWiki MCP server: serves the repo's generated wiki (openwiki/) from a
// persistent worktree of the default branch, over MCP stdio. The read tools are
// model-free: search builds an in-memory FTS index per call, so no database is kept.
// Generation runs elsewhere, against a disposable worktree; serving must never see a
// half-written wiki mid-generation.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { storage } from "../db.js";
import { REPO_DIR, fetchRepo, git } from "../repositories/git.js";

// Persistent checkout of origin/HEAD that the MCP server reads the wiki from.
export const SERVE_DIR = resolve(dirname(storage), "wiki-serve");

// OpenWiki's own state (registry, saved settings): kept in zini's data dir,
// never in the user's home.
const CONFIG_DIR = resolve(dirname(storage), "openwiki");

const START_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 120_000;

// The serving worktree exists and has a wiki checked out.
export function hasServedWiki(): boolean {
  return existsSync(join(SERVE_DIR, "openwiki"));
}

// Create the serving worktree if it's missing. The bare clone is the source of
// truth; the worktree shares its objects, so this is one cheap checkout.
export async function ensureServingWorktree(): Promise<void> {
  if (existsSync(join(SERVE_DIR, ".git"))) return;
  await fetchRepo();
  await git(["-C", REPO_DIR, "worktree", "add", "--detach", SERVE_DIR, "origin/HEAD"]);
}

// Bring the serving worktree up to the latest default branch. Returns the new HEAD.
export async function refreshServingWorktree(): Promise<{ commit: string }> {
  await ensureServingWorktree();
  await fetchRepo();
  await git(["-C", SERVE_DIR, "reset", "--hard", "origin/HEAD"]);
  const commit = (await git(["-C", SERVE_DIR, "rev-parse", "HEAD"])).trim();
  return { commit };
}

// What the MCP server reads (null when there's no serving worktree yet) and what
// the bare clone has (null when the repo was never fetched): the UI compares them
// to show whether the served wiki is stale.
export async function getServingStatus(): Promise<{ commit: string | null; mainCommit: string | null }> {
  let commit: string | null = null;
  if (existsSync(join(SERVE_DIR, ".git"))) {
    try {
      commit = (await git(["-C", SERVE_DIR, "rev-parse", "HEAD"])).trim() || null;
    } catch {
      commit = null;
    }
  }
  let mainCommit: string | null = null;
  if (existsSync(REPO_DIR)) {
    try {
      mainCommit = (await git(["-C", REPO_DIR, "rev-parse", "origin/HEAD"])).trim() || null;
    } catch {
      mainCommit = null;
    }
  }
  return { commit, mainCommit };
}

// --- MCP server process -------------------------------------------------------

let client: Client | null = null;
let starting: Promise<Client> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

async function startClient(): Promise<Client> {
  let bin: string;
  try {
    const require = createRequire(import.meta.url);
    bin = join(dirname(require.resolve("openwiki/package.json")), "dist", "cli", "cli.js");
  } catch (err) {
    throw new Error(`Couldn't locate the bundled openwiki package: ${err instanceof Error ? err.message : err}`);
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, "mcp", "--host", "zini"],
    cwd: SERVE_DIR,
    env: {
      ...process.env,
      OPENWIKI_CONFIG_DIR: CONFIG_DIR,
      OPENWIKI_TELEMETRY_DISABLED: "1",
    },
    stderr: "pipe",
  });
  const next = new Client({ name: "zini", version: "1.0.0" }, { capabilities: {} });
  try {
    await withTimeout(next.connect(transport), START_TIMEOUT_MS, "Starting the OpenWiki MCP server");
  } catch (err) {
    await next.close().catch(() => {});
    throw new Error(`Couldn't start the OpenWiki MCP server: ${err instanceof Error ? err.message : err}`);
  }
  return next;
}

async function getClient(): Promise<Client> {
  if (client) return client;
  starting ??= startClient().finally(() => {
    starting = null;
  });
  client = await starting;
  return client;
}

// Best-effort cleanup, e.g. on backend shutdown.
export async function closeMcp(): Promise<void> {
  const next = client;
  client = null;
  if (next) await next.close().catch(() => {});
}

function toolText(result: CallToolResult, toolName: string): string {
  const texts: string[] = [];
  for (const block of result.content) {
    if (block.type === "text") texts.push(block.text);
  }
  const text = texts.join("\n");
  if (result.isError) throw new Error(`${toolName} failed: ${text || "unknown error"}`);
  return text;
}

async function callWikiTool(name: string, args: Record<string, unknown>): Promise<string> {
  const next = await getClient();
  const result = await withTimeout(
    next.callTool({ name, arguments: args }),
    CALL_TIMEOUT_MS,
    `OpenWiki ${name}`,
  );
  return toolText(result as CallToolResult, name);
}

// Search the served wiki. Returns a compact JSON array of { page, section, excerpt }.
export async function searchWiki(query: string, limit?: number): Promise<string> {
  if (!hasServedWiki()) throw new Error("No wiki is being served; generate the documentation first.");
  const text = await callWikiTool("openwiki_search", {
    root: SERVE_DIR,
    query,
    ...(limit !== undefined ? { limit } : {}),
  });
  let parsed: { results?: Array<{ ref?: string[] | string; content?: string }>; status?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (parsed.status === "workspace_required") return text;
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  return JSON.stringify(
    results.map((r) => {
      const ref = Array.isArray(r.ref) ? (r.ref[0] ?? "") : (r.ref ?? "");
      const hash = ref.indexOf("#");
      const page = (hash >= 0 ? ref.slice(0, hash) : ref).replace(/^openwiki\//, "");
      return { page, section: hash >= 0 ? ref.slice(hash + 1) : null, excerpt: r.content ?? "" };
    }),
  );
}

// Read a wiki page (whole page, or exact sections). Page stays under openwiki/.
export async function readWikiPage(page: string, sections?: string[]): Promise<string> {
  const safe = normalizeWikiPath(page);
  if (!hasServedWiki()) throw new Error("No wiki is being served; generate the documentation first.");
  if (sections && sections.length > 0) {
    const text = await callWikiTool("openwiki_read", {
      root: SERVE_DIR,
      page: `openwiki/${safe}`,
      sections,
    });
    let parsed: { sections?: Array<{ content?: string }> };
    try {
      parsed = JSON.parse(text);
    } catch {
      return text;
    }
    return (parsed.sections ?? []).map((s) => s.content ?? "").join("\n\n---\n\n");
  }
  return await readFile(join(SERVE_DIR, "openwiki", safe), "utf8");
}

function normalizeWikiPath(page: string): string {
  const stripped = page.trim().replace(/^openwiki\//, "");
  if (!stripped || stripped.startsWith("/") || stripped.split("/").includes("..")) {
    throw new Error(`Invalid wiki page path: ${page}`);
  }
  return stripped;
}
