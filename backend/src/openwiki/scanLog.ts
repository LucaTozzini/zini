import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectDir } from "../projects/projects.js";
import type { Repo } from "../repositories/git.js";

// A log of each docs scan, for debugging: every event openwiki reports (its progress,
// each tool call its agents make, its notices) and zini's own steps around it, as
// { type: "scan", stage, ... } entries. One JSON Lines file per scan, written as the
// scan goes, so it can be watched live (Get-Content -Wait, tail -f) and a scan that
// fails still leaves everything up to the failure:
//   data/projects/<project id>/openwiki-logs/<when it started>.jsonl
// e.g. 2026-10-15T10-33-26-701Z.jsonl, so the names sort by time.

const logDir = (repo: Repo) => join(projectDir(repo.id), "openwiki-logs");

export type ScanLog = { write: <T extends { type: string }>(entry: T) => Promise<void> };

export async function openScanLog(repo: Repo, startedAt: string): Promise<ScanLog> {
  await mkdir(logDir(repo), { recursive: true });
  const file = join(logDir(repo), `${startedAt.replace(/[:.]/g, "-")}.jsonl`);
  // Appends one at a time, so lines stay in order when agents run tools in parallel.
  let queue = Promise.resolve();
  return {
    write(entry) {
      queue = queue
        .then(() => appendFile(file, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`))
        .catch((err) => {
          console.error(`Writing the scan log ${file} failed:`, err);
        });
      return queue;
    },
  };
}

// The latest scan's log, or null if no scan has run. A line still being written is
// left out; the next read has it.
export async function readLatestScanLog(repo: Repo): Promise<Record<string, unknown>[] | null> {
  const files = (await readdir(logDir(repo)).catch(() => [])).filter((f) => f.endsWith(".jsonl")).sort();
  const latest = files.at(-1);
  if (!latest) return null;
  const text = await readFile(join(logDir(repo), latest), "utf8");
  return text.split("\n").flatMap((line) => {
    try {
      return line ? [JSON.parse(line) as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}
