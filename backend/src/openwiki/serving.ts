// Serves the repo's generated wiki (openwiki/) from a persistent worktree of the
// default branch, for the Docs page and the agents' wiki tools. Search and read call
// openwiki's retrieval in zini's process: model-free, search builds an in-memory index
// per call, so no database is kept. Generation runs elsewhere, against a disposable
// worktree; serving must never see a half-written wiki mid-generation.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchRepo, git, type Repo } from "../repositories/git.js";
import { projectDir, repoDir } from "../projects/projects.js";
import { loadOpenwiki } from "./openwiki.js";

// Each project's persistent checkout of origin/HEAD that its wiki is served from.
const serveDir = (repo: Repo) => join(projectDir(repo.id), "wiki-serve");

// The serving worktree exists and has a wiki checked out.
export function hasServedWiki(repo: Repo): boolean {
  return existsSync(join(serveDir(repo), "openwiki"));
}

// Create the serving worktree if it's missing. The bare clone is the source of
// truth; the worktree shares its objects, so this is one cheap checkout.
export async function ensureServingWorktree(repo: Repo): Promise<void> {
  if (existsSync(join(serveDir(repo), ".git"))) return;
  await fetchRepo(repo);
  await git(["-C", repoDir(repo.id), "worktree", "add", "--detach", serveDir(repo), "origin/HEAD"]);
}

// Bring the serving worktree up to the latest default branch. Returns the new HEAD.
export async function refreshServingWorktree(repo: Repo): Promise<{ commit: string }> {
  await ensureServingWorktree(repo);
  await fetchRepo(repo);
  await git(["-C", serveDir(repo), "reset", "--hard", "origin/HEAD"]);
  const commit = (await git(["-C", serveDir(repo), "rev-parse", "HEAD"])).trim();
  return { commit };
}

// What the wiki is served from (null when there's no serving worktree yet) and what
// the bare clone has (null when the repo was never fetched): the UI compares them
// to show whether the served wiki is stale.
export async function getServingStatus(repo: Repo): Promise<{ commit: string | null; mainCommit: string | null }> {
  let commit: string | null = null;
  if (existsSync(join(serveDir(repo), ".git"))) {
    try {
      commit = (await git(["-C", serveDir(repo), "rev-parse", "HEAD"])).trim() || null;
    } catch {
      commit = null;
    }
  }
  let mainCommit: string | null = null;
  if (existsSync(repoDir(repo.id))) {
    try {
      mainCommit = (await git(["-C", repoDir(repo.id), "rev-parse", "origin/HEAD"])).trim() || null;
    } catch {
      mainCommit = null;
    }
  }
  return { commit, mainCommit };
}

// Search the served wiki. Returns a compact JSON array of { page, section, excerpt }.
export async function searchWiki(repo: Repo, query: string, limit?: number): Promise<string> {
  if (!hasServedWiki(repo)) throw new Error("No wiki is being served; generate the documentation first.");
  const openwiki = await loadOpenwiki();
  const response = await openwiki.searchWiki(serveDir(repo), { query, ...(limit !== undefined ? { limit } : {}) });
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
export async function readWikiPage(repo: Repo, page: string, sections?: string[]): Promise<string> {
  const safe = normalizeWikiPath(page);
  if (!hasServedWiki(repo)) throw new Error("No wiki is being served; generate the documentation first.");
  if (sections && sections.length > 0) {
    const openwiki = await loadOpenwiki();
    const response = await openwiki.readWikiSections(serveDir(repo), { page: `openwiki/${safe}`, sections });
    return response.sections.map((s) => s.content).join("\n\n---\n\n");
  }
  return await readFile(join(serveDir(repo), "openwiki", safe), "utf8");
}

function normalizeWikiPath(page: string): string {
  const stripped = page.trim().replace(/^openwiki\//, "");
  if (!stripped || stripped.startsWith("/") || stripped.split("/").includes("..")) {
    throw new Error(`Invalid wiki page path: ${page}`);
  }
  return stripped;
}
