import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The source actually copied into the image, including uncommitted changes.
export function codeVersion(root = resolve(import.meta.dirname, "../..")) {
  const hash = createHash("sha256");
  function add(folder: string) {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) add(path);
      else if (/\.(ts|json)$/.test(entry.name)) hash.update(path).update("\0").update(readFileSync(join(root, path)));
    }
  }
  for (const folder of ["backend/src", "shared/src", "evals/harness", "evals/scenarios"]) add(folder);
  hash.update(readFileSync(join(root, "evals/run.ts")));
  hash.update(readFileSync(join(root, "package-lock.json")));
  return hash.digest("hex");
}
