import { dirname, join, resolve } from "node:path";
import { storage } from "../db.js";
import { Project } from "../models/Project.js";
import { Workspace } from "../models/Workspace.js";

// Each project's own files, in zini's data folder: its repo's bare clone, the OpenWiki
// checkouts and scan logs, and the Project Lead's notes. Absolute, since git runs with
// -C and would read a relative path from there.
export const projectDir = (projectId: number) => resolve(dirname(storage), "projects", String(projectId));
export const repoDir = (projectId: number) => join(projectDir(projectId), "repo.git");

export async function getProject(projectId: number) {
  const project = await Project.findByPk(projectId);
  if (!project) throw new Error("Project not found");
  return project;
}

// The project an issue's workspace was cloned for.
export async function workspaceProject(issueId: string) {
  const workspace = await Workspace.findByPk(issueId, { attributes: ["projectId"] });
  if (!workspace) throw new Error("This issue has no workspace");
  return getProject(workspace.projectId);
}

// The project whose work a Linear team's issues are, or null if none is.
export const teamProject = (linearTeamId: string) => Project.findOne({ where: { linearTeamId } });
