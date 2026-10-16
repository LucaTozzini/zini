import { dirname, resolve } from "node:path";
import { storage } from "../db.js";

// OpenWiki's own state (its skills, run metadata): kept in zini's data dir, never in
// the user's home.
const CONFIG_DIR = resolve(dirname(storage), "openwiki-config");

let loading: ReturnType<typeof load> | null = null;

// The openwiki functions zini uses, run in zini's process. Its modules read
// OPENWIKI_CONFIG_DIR once, when first loaded, so they're loaded on first use, after
// it's set. They're internals, not a public API: openwiki is pinned to an exact version.
export function loadOpenwiki() {
  loading ??= load();
  return loading;
}

async function load() {
  process.env.OPENWIKI_CONFIG_DIR = CONFIG_DIR;
  process.env.OPENWIKI_TELEMETRY_DISABLED = "1";
  const [{ syncBundledSkills }, { runNativeRepositoryGeneration }, { searchWiki, readWikiSections }] =
    await Promise.all([
      import("openwiki/dist/agent/skills.js"),
      import("openwiki/dist/agent/repository-runner.js"),
      import("openwiki/dist/retrieval/wiki.js"),
    ]);
  return { syncBundledSkills, runNativeRepositoryGeneration, searchWiki, readWikiSections };
}
