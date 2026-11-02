import { z } from "zod";
import { sequelize } from "../db.js";
import { DevelopmentVariable } from "../models/DevelopmentVariable.js";
import { Workspace } from "../models/Workspace.js";

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

// A project's development variables, which its workspaces' apps run with.
export async function saveDevelopmentEnvironment(projectId: number, changes: z.infer<typeof DEVELOPMENT_CHANGES>["variables"]) {
  for (const change of changes) validateDevelopmentValues({ [change.name]: "value" in change ? change.value : "" });
  await sequelize.transaction(async (transaction) => {
    for (const change of changes) {
      if ("remove" in change) await DevelopmentVariable.destroy({ where: { projectId, name: change.name }, transaction });
      else await DevelopmentVariable.upsert({ projectId, name: change.name, value: change.value }, { transaction });
    }
    if ((await DevelopmentVariable.count({ where: { projectId }, transaction })) > 100)
      throw new Error("At most 100 development variables per project");
  });
}
async function variablesFor(projectId: number): Promise<Record<string, string>> {
  const rows = await DevelopmentVariable.findAll({ where: { projectId }, order: [["name", "ASC"]] });
  return Object.fromEntries(rows.map((row) => [row.name, row.value]));
}
export async function developmentEnvironmentStatus(projectId: number) {
  const values = await variablesFor(projectId);
  return { variables: Object.entries(values).map(([name, value]) => ({ name, configured: Boolean(value) })) };
}
// The variables of the project the issue's workspace belongs to.
export async function activeDevelopmentEnvironment(issueId: string): Promise<Record<string, string>> {
  const workspace = await Workspace.findByPk(issueId, { attributes: ["projectId"] });
  return workspace ? variablesFor(workspace.projectId) : {};
}
export async function developmentEnvironmentContext(issueId: string) {
  const workspace = await Workspace.findByPk(issueId, { attributes: ["projectId"] });
  const values = workspace ? await variablesFor(workspace.projectId) : {};
  return JSON.stringify({
    settings: workspace ? `/projects/${workspace.projectId}/settings` : "/",
    variables: Object.entries(values).map(([name, value]) => ({ name, configured: Boolean(value) })),
  });
}
