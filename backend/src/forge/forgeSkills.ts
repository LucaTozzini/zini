import { fileURLToPath } from "node:url";
import { CompositeBackend, createSkillsMiddleware, FilesystemBackend, type BackendProtocolV2 } from "deepagents";
import { containerFilesystem } from "../workspaces/containerFilesystem.js";

// zini's skills for the Forge agents: Agent Skills folders (<name>/SKILL.md) in
// backend/forge-skills. They're on the host, so the agents' file tools reach them under
// this path, read-only, beside the workspace's files.
export const FORGE_SKILLS = "/forge-skills/";
const SKILLS_DIR = fileURLToPath(new URL("../../forge-skills", import.meta.url));

const skillsBackend = (): BackendProtocolV2 => {
  const disk = new FilesystemBackend({ rootDir: SKILLS_DIR, virtualMode: true });
  const readOnly = { error: "Forge skills are read-only" };
  return {
    ls: (path) => disk.ls(path),
    read: (path, offset, limit) => disk.read(path, offset, limit),
    readRaw: (path) => disk.readRaw(path),
    // How the skills middleware reads each SKILL.md.
    downloadFiles: (paths) => disk.downloadFiles(paths),
    glob: (pattern, path) => disk.glob(pattern, path),
    grep: (pattern, path, glob, maxCount) => disk.grep(pattern, path ?? undefined, glob, maxCount),
    write: async () => readOnly,
    edit: async () => readOnly,
  };
};

// The issue's workspace, with the Forge skills under FORGE_SKILLS.
export const forgeFilesystem = (issueId: string, writable = false, notify?: () => void) =>
  new CompositeBackend(containerFilesystem(issueId, writable, notify), { [FORGE_SKILLS]: skillsBackend() });

// Lists the Forge skills' names and descriptions in the prompt; the agent reads a
// skill's SKILL.md with read_file when it applies.
export const forgeSkillsMiddleware = (issueId: string) =>
  createSkillsMiddleware({ backend: forgeFilesystem(issueId), sources: [FORGE_SKILLS] });
