import assert from "node:assert/strict";
import test from "node:test";
import { forgeFilesystem, forgeSkillsMiddleware } from "./forgeSkills.js";

test("the Forge skills are readable under /forge-skills/, and not writable", async () => {
  const filesystem = forgeFilesystem("issue", true);
  const read = await filesystem.read("/forge-skills/ponytail/SKILL.md");
  assert.match(JSON.stringify(read), /name: ponytail/);
  assert.deepEqual(await filesystem.write("/forge-skills/ponytail/SKILL.md", "changed"), { error: "Forge skills are read-only" });
  assert.deepEqual(await filesystem.edit("/forge-skills/ponytail/SKILL.md", "ponytail", "changed"), {
    error: "Forge skills are read-only",
  });
});

test("every Forge skill is listed with its description and the path to read it at", async () => {
  const middleware = forgeSkillsMiddleware("issue");
  const beforeAgent = (middleware.beforeAgent ?? middleware.beforeModel) as unknown as (
    state: object,
    runtime: object,
  ) => Promise<{ skillsMetadata?: { name: string; description: string; path: string }[] } | undefined>;
  const update = await beforeAgent({ messages: [] }, { context: {} });
  const ponytail = update?.skillsMetadata?.find((skill) => skill.name === "ponytail");
  assert.equal(ponytail?.path, "/forge-skills/ponytail/SKILL.md");
  assert.match(ponytail?.description ?? "", /smallest change that fully solves the task/);
});
