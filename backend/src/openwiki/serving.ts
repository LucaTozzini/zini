// Serves the repo's generated wiki (openwiki/) from a persistent worktree of the
// default branch, for the Docs page and the agents' wiki tools. Search and read call
// openwiki's retrieval in zini's process: model-free, search builds an in-memory index
// per call, so no database is kept. Generation runs elsewhere, against a disposable
// worktree; serving must never see a half-written wiki mid-generation.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { storage } from "../db.js";
import { REPO_DIR, fetchRepo, git } from "../repositories/git.js";
import { loadOpenwiki } from "./openwiki.js";

// Persistent checkout of origin/HEAD that the wiki is served from.
export const SERVE_DIR = resolve(dirname(storage), "wiki-serve");

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

// What the wiki is served from (null when there's no serving worktree yet) and what
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

// Search the served wiki. Returns a compact JSON array of { page, section, excerpt }.
export async function searchWiki(query: string, limit?: number): Promise<string> {
  if (!hasServedWiki()) throw new Error("No wiki is being served; generate the documentation first.");
  const openwiki = await loadOpenwiki();
  const response = await openwiki.searchWiki(SERVE_DIR, { query, ...(limit !== undefined ? { limit } : {}) });
  if (!("results" in response)) return JSON.stringify(response);
  return JSON.stringify(
    response.results.map((r) => {
      const ref = r.ref[0] ?? "";
      const hash = ref.indexOf("#");
      const page = (hash >= 0 ? ref.slice(0, hash) : ref).replace(/^openwiki\//, "");
      return { page, section: hash >= 0 ? ref.slice(hash + 1) : null, excerpt: r.content };
    }),
  );
}

// Read a wiki page (whole page, or exact sections). Page stays under openwiki/.
export async function readWikiPage(page: string, sections?: string[]): Promise<string> {
  const safe = normalizeWikiPath(page);
  if (!hasServedWiki()) throw new Error("No wiki is being served; generate the documentation first.");
  if (sections && sections.length > 0) {
    const openwiki = await loadOpenwiki();
    const response = await openwiki.readWikiSections(SERVE_DIR, { page: `openwiki/${safe}`, sections });
    return response.sections.map((s) => s.content).join("\n\n---\n\n");
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
