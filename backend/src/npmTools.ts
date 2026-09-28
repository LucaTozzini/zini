import { tool } from "langchain";
import { z } from "zod";
import {
  listPackageFiles,
  packageVersions,
  readPackageFile,
  searchPackage,
} from "./npmPackages.js";

// Tools for reading npm packages (see npmPackages.ts), the same for every agent: the
// repo's files never include node_modules, so this is how an agent reads a
// dependency's code and types.

const PACKAGE = z
  .string()
  .describe(
    'name@version, e.g. "langchain@1.5.12" or "@langchain/core@1.2.12". Use the version ' +
      "the repo has (package.json or the lockfile); a tag like latest also works.",
  );

export const npmTools = [
  tool(async ({ name }) => packageVersions(name), {
    name: "npm_package_versions",
    description:
      "A package's description, tags (e.g. latest) and most recent versions, from npm.",
    schema: z.object({ name: z.string().describe('e.g. "langchain"') }),
  }),
  tool(async ({ package: spec, path }) => listPackageFiles(spec, path ?? ""), {
    name: "npm_list_files",
    description:
      "List a folder's files and subfolders (subfolders end in /) in an npm package, as " +
      "published. Omit path for the package's root.",
    schema: z.object({ package: PACKAGE, path: z.string().optional() }),
  }),
  tool(
    async ({ package: spec, path, startLine, endLine }) =>
      readPackageFile(spec, path, startLine, endLine),
    {
      name: "npm_read_file",
      description:
        "Read a file in an npm package, with line numbers. Long files are cut off with a " +
        "note saying which startLine to read on from.",
      schema: z.object({
        package: PACKAGE,
        path: z.string().describe('e.g. "dist/index.d.ts"'),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      }),
    },
  ),
  tool(async ({ package: spec, query }) => searchPackage(spec, query), {
    name: "npm_search",
    description:
      "Find lines containing some text (plain text, any case) in an npm package, as " +
      "path:line:text, e.g. where something is exported or declared. Up to 100 matches.",
    schema: z.object({ package: PACKAGE, query: z.string().min(1) }),
  }),
];
