# Forge skills

Skills for the Forge's agents (Lead, Coder and Reviewer), in the Agent Skills format: one folder per skill with a `SKILL.md` whose frontmatter has a `name` and a `description`. Each agent sees every skill's name and description, and reads a skill when it applies (see `src/forge/forgeSkills.ts`). The agents read them at `/forge-skills/`, read-only.

Skills from elsewhere are copied here, pinned, rather than fetched while the agents run, so they only change when updated here.

| Skill | Source | Commit |
| --- | --- | --- |
| ponytail | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) `skills/ponytail` (MIT) | `09c434ab73ca43761c5d8b0c5d341926c2fba710` |
