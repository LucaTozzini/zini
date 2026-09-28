import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { x as extract } from "tar";
import { storage } from "./db.js";
import { cleanPath, formatMatches, git, numberedLines } from "./git.js";

// Packages from the public npm registry, for the agents to read a dependency's code
// and types at the version the repo uses (git only sees tracked files, so never
// node_modules). A version is downloaded once, as the tarball npm install uses,
// unpacked into PACKAGES_DIR and kept: a published version never changes. Nothing
// from a package is ever run. A package is "name@version", where version is exact
// (1.5.12) or a tag (latest); without one, it's latest.

const REGISTRY = "https://registry.npmjs.org";

// data/npm-packages/<name>@<version>, e.g. @langchain/core@1.2.12. Absolute, since git
// runs with -C in a package's folder.
const PACKAGES_DIR = resolve(dirname(storage), "npm-packages");

// How many versions packageVersions lists.
const MAX_VERSIONS = 20;

// npm package names, scoped or not, e.g. langchain or @langchain/core.
const NAME = /^(@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*$/i;
// An exact version (1.5.12, 1.0.0-alpha.9) or a tag (latest, next).
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/;
const TAG = /^[a-z][\w.-]*$/i;

// "name@version" split in two. The version defaults to latest.
function parseSpec(spec: string) {
  spec = spec.trim();
  // A scoped name starts with @, so the version's @ is the one after it.
  const at = spec.indexOf("@", 1);
  const name = at === -1 ? spec : spec.slice(0, at);
  const version = at === -1 ? "latest" : spec.slice(at + 1);
  if (!NAME.test(name) || name.includes(".."))
    throw new Error(`${name} isn't a valid npm package name`);
  if (!EXACT_VERSION.test(version) && !TAG.test(version)) {
    throw new Error(
      `${version} isn't an exact version (e.g. 1.2.3) or a tag (e.g. latest)`,
    );
  }
  return { name, version };
}

async function registryJson(path: string, notFound: string) {
  const res = await fetch(`${REGISTRY}/${path}`);
  if (res.status === 404) throw new Error(notFound);
  if (!res.ok)
    throw new Error(`The npm registry answered ${res.status} for ${path}`);
  return res.json();
}

type Manifest = { version: string; dist: { tarball: string } };

// One version's package.json as published, with its tarball's URL. version
// can be a tag.
const fetchManifest = (name: string, version: string) =>
  registryJson(
    `${name}/${version}`,
    `No version or tag ${version} of ${name} on npm`,
  ) as Promise<Manifest>;

// A package's tags, and its most recent versions with their publish dates, newest first.
export async function packageVersions(name: string) {
  name = parseSpec(name).name;
  const doc = (await registryJson(name, `No package named ${name} on npm`)) as {
    description?: string;
    "dist-tags": Record<string, string>;
    versions: Record<string, unknown>;
    time?: Record<string, string>;
  };
  const time = doc.time ?? {};
  const versions = Object.keys(doc.versions).sort((a, b) =>
    (time[b] ?? "").localeCompare(time[a] ?? ""),
  );
  const tags = Object.entries(doc["dist-tags"]).map(
    ([tag, version]) => `${tag} ${version}`,
  );
  return [
    `${name}${doc.description ? `: ${doc.description}` : ""}`,
    `Tags: ${tags.join(", ")}`,
    `Latest ${Math.min(MAX_VERSIONS, versions.length)} of ${versions.length} versions, newest first:`,
    ...versions
      .slice(0, MAX_VERSIONS)
      .map((v) => `${v}${time[v] ? `  ${time[v].slice(0, 10)}` : ""}`),
  ].join("\n");
}

// Downloads in progress, by folder, so parallel calls for the same version share one.
const downloads = new Map<string, Promise<void>>();

// Downloads a version's tarball and unpacks it into dir as it arrives. It's unpacked
// beside dir first and moved into place once complete, so a failed download never
// leaves a half-unpacked package behind.
async function download(name: string, manifest: Manifest, dir: string) {
  const res = await fetch(manifest.dist.tarball);
  if (!res.ok || !res.body)
    throw new Error(
      `Downloading ${name}@${manifest.version} failed: ${res.status}`,
    );

  const partial = `${dir}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    // A tarball's files are all in one top folder, usually package/.
    await pipeline(
      Readable.fromWeb(res.body),
      extract({ cwd: partial, strip: 1 }),
    );
    await rename(partial, dir);
  } catch (err) {
    await rm(partial, { recursive: true, force: true });
    throw err;
  }
}

// A package's folder, downloading it first if needed, and a note naming the version a
// tag resolved to. An exact version already downloaded needs no request.
async function openPackage(spec: string) {
  const { name, version } = parseSpec(spec);
  if (EXACT_VERSION.test(version)) {
    const dir = join(PACKAGES_DIR, `${name}@${version}`);
    if (existsSync(dir)) return { dir, note: "" };
  }
  const manifest = await fetchManifest(name, version);
  const dir = join(PACKAGES_DIR, `${name}@${manifest.version}`);
  if (!existsSync(dir)) {
    let pending = downloads.get(dir);
    if (!pending) {
      pending = download(name, manifest, dir).finally(() =>
        downloads.delete(dir),
      );
      downloads.set(dir, pending);
    }
    await pending;
  }
  const note =
    version === manifest.version
      ? ""
      : `[${name}@${version} is ${manifest.version}]\n`;
  return { dir, note };
}

// A path inside a package's folder: the full path, and the path relative to the
// package with forward slashes. Throws for one outside it.
function resolveIn(dir: string, path: string) {
  const full = resolve(dir, cleanPath(path));
  const rel = relative(dir, full);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error(`${path} is outside the package`);
  return { full, rel: rel.split(sep).join("/") };
}

// A folder's files and subfolders (subfolders end in /). Omit path for the root.
export async function listPackageFiles(spec: string, path = "") {
  const { dir, note } = await openPackage(spec);
  const { full, rel } = resolveIn(dir, path);
  if (!existsSync(full)) throw new Error(`No folder at ${rel}`);
  if (!(await stat(full)).isDirectory()) throw new Error(`${rel} is a file`);
  const entries = (await readdir(full, { withFileTypes: true }))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();
  return note + (entries.join("\n") || "Empty folder");
}

// A file's lines, numbered, from startLine to endLine (see numberedLines).
export async function readPackageFile(
  spec: string,
  path: string,
  startLine?: number,
  endLine?: number,
) {
  const { dir, note } = await openPackage(spec);
  const { full, rel } = resolveIn(dir, path);
  if (!existsSync(full)) throw new Error(`No file at ${rel}`);
  if ((await stat(full)).isDirectory()) throw new Error(`${rel} is a folder`);
  return (
    note + numberedLines(rel, await readFile(full, "utf8"), startLine, endLine)
  );
}

// Lines containing query (plain text, any case), as "path:line:text", skipping source
// maps and minified files.
export async function searchPackage(spec: string, query: string) {
  const { dir, note } = await openPackage(spec);
  // The folder isn't a git repo: --no-index searches it as plain files.
  const out = await git(
    [
      "-C",
      dir,
      "grep",
      "--no-index",
      "-n",
      "-I",
      "-i",
      "-F",
      "-e",
      query,
      "--",
      ".",
      ":(exclude)*.map",
      ":(exclude)*.min.js",
    ],
    undefined,
    { exit1Ok: true },
  );
  return note + formatMatches(out.split("\n"));
}
