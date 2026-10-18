import { z } from "zod";
import { sequelize } from "../db.js";
import { DevelopmentVariable } from "../models/DevelopmentVariable.js";
import { getSetting } from "./settings.js";

export function validateDevelopmentValues(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    if (
      !/^[A-Z][A-Z0-9_]{0,79}$/.test(name) ||
      /^(PATH|HOME|SHELL|BASH_ENV|ENV|LD_.*|NODE_OPTIONS|NODE_PATH|PLAYWRIGHT_.*|GIT_.*|WORKSPACE_.*)$/.test(name)
    )
      throw new Error(`Reserved or invalid environment variable: ${name}`);
    if (value.length > 4096 || value.includes("\0")) throw new Error(`Invalid value for ${name}`);
  }
}
export const DEVELOPMENT_CHANGES = z
  .object({
    repository: z.string().min(1),
    variables: z
      .array(
        z.union([
          z.object({ name: z.string(), value: z.string() }).strict(),
          z.object({ name: z.string(), remove: z.literal(true) }).strict(),
        ]),
      )
      .max(100),
  })
  .strict();

export async function saveDevelopmentEnvironment(repository: string, changes: z.infer<typeof DEVELOPMENT_CHANGES>["variables"]) {
  for (const change of changes) validateDevelopmentValues({ [change.name]: "value" in change ? change.value : "" });
  await sequelize.transaction(async (transaction) => {
    for (const change of changes) {
      if ("remove" in change) await DevelopmentVariable.destroy({ where: { repository, name: change.name }, transaction });
      else await DevelopmentVariable.upsert({ repository, name: change.name, value: change.value }, { transaction });
    }
    if ((await DevelopmentVariable.count({ where: { repository }, transaction })) > 100)
      throw new Error("At most 100 development variables per repository");
  });
}
async function variablesFor(repository: string): Promise<Record<string, string>> {
  const rows = await DevelopmentVariable.findAll({ where: { repository }, order: [["name", "ASC"]] });
  return Object.fromEntries(rows.map((row) => [row.name, row.value]));
}
export async function developmentEnvironmentStatus(repository: string) {
  const values = await variablesFor(repository);
  return { repository, variables: Object.entries(values).map(([name, value]) => ({ name, configured: Boolean(value) })) };
}
export async function activeDevelopmentEnvironment(): Promise<Record<string, string>> {
  const repository = await getSetting("githubRepo");
  return repository ? variablesFor(repository) : {};
}
export async function developmentEnvironmentContext() {
  const values = await activeDevelopmentEnvironment();
  return JSON.stringify({
    settings: "/settings",
    variables: Object.entries(values).map(([name, value]) => ({ name, configured: Boolean(value) })),
  });
}
