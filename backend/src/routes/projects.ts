import { rm } from "node:fs/promises";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Project as ProjectResponse, ProjectSummary } from "shared";
import { parseEnv } from "node:util";
import { z } from "zod";
import { Project } from "../models/Project.js";
import { ProjectLeadThread } from "../models/ProjectLeadThread.js";
import { Workspace } from "../models/Workspace.js";
import { getKey } from "../models/Integration.js";
import { fetchLinearTeams, getLinearClient } from "../integrations/linear.js";
import { cloneRepo } from "../repositories/git.js";
import { withRepositoryLock } from "../repositories/repositoryLock.js";
import { projectDir } from "../projects/projects.js";
import { deleteWorkspace, isForgeRunning } from "../workspaces/workspaces.js";
import { workspaceApps } from "../workspaces/workspaceAppSessions.js";
import { deleteThreadHistory } from "../projectLead/projectLead.js";
import { forgetRun, isRunning } from "../agents/runs.js";
import { DEVELOPMENT_CHANGES, developmentEnvironmentStatus, saveDevelopmentEnvironment } from "../core/developmentEnvironment.js";
import { errorMessage } from "../core/errors.js";
import { currentProject, parse } from "./http.js";
import { projectIntegrations } from "./integrations.js";
import { projectLinear } from "./linear.js";
import { projectLead } from "./projectLead.js";
import { database } from "./database.js";
import { openwiki } from "../openwiki/routes.js";
import { openwikiServe } from "../openwiki/serveRoutes.js";

// The projects, at /api/projects, and everything that belongs to one, at
// /api/projects/:projectId.
export const projects = Router();

const toResponse = ({ id, name, githubRepo, linearTeamId }: Project): ProjectResponse => ({ id, name, githubRepo, linearTeamId });

const name = z.string({ error: "name must be a string" }).trim().min(1, "Give the project a name").max(100);
const newProject = z.object({
  githubRepo: z
    .string({ error: "Choose a GitHub repository" })
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, "The repository must look like owner/name"),
  linearTeamId: z.string({ error: "Choose a Linear team" }).trim().min(1, "Choose a Linear team"),
  // The repo's name by default.
  name: name.optional(),
});

// Oldest first, each with how many of its Forges are running.
projects.get("/", async (_req, res) => {
  const [rows, workspaces] = await Promise.all([
    Project.findAll({ order: [["createdAt", "ASC"]] }),
    Workspace.findAll({ attributes: ["issueId", "projectId"] }),
  ]);
  res.json(
    rows.map((project): ProjectSummary => ({
      ...toResponse(project),
      runningForges: workspaces.filter((w) => w.projectId === project.id && isForgeRunning(w.issueId)).length,
    })),
  );
});

// Creates a project once its repo is cloned, which also checks the token can read it.
projects.post("/", async (req, res) => {
  const body = parse(newProject, req.body, res);
  if (!body) return;
  const { githubRepo, linearTeamId } = body;

  const [token, linear] = await Promise.all([getKey("github"), getLinearClient()]);
  if (!token || !linear) {
    res.status(409).json({ error: "Connect Linear and GitHub before adding a project" });
    return;
  }
  const { teams } = await fetchLinearTeams(linear);
  const team = teams.find((t) => t.id === linearTeamId);
  if (!team) {
    res.status(400).json({ error: "That Linear team doesn't exist" });
    return;
  }
  if (await Project.findOne({ where: { linearTeamId } })) {
    res.status(409).json({ error: `${team.name} is already another project's team` });
    return;
  }
  if (await Project.findOne({ where: { githubRepo } })) {
    res.status(409).json({ error: `${githubRepo} is already a project` });
    return;
  }

  const project = await Project.create({ githubRepo, linearTeamId, name: body.name ?? githubRepo.split("/")[1]! });
  try {
    await cloneRepo(project);
  } catch (err) {
    await project.destroy();
    await rm(projectDir(project.id), { recursive: true, force: true });
    console.error(`Cloning ${githubRepo} failed:`, err);
    // A failed git command's message ends with its "fatal: ..." line.
    res.status(400).json({ error: `Couldn't clone ${githubRepo}: ${errorMessage(err).trim().split("\n").at(-1)}` });
    return;
  }
  res.status(201).json(toResponse(project));
});

// Finds the project for every route below, or answers 404.
async function loadProject(req: Request, res: Response, next: NextFunction) {
  const id = String(req.params.projectId);
  const project = /^\d+$/.test(id) ? await Project.findByPk(Number(id)) : null;
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.locals.project = project;
  next();
}

const project = Router();
projects.use("/:projectId", loadProject, project);

project.get("/", (_req, res) => {
  res.json(toResponse(currentProject(res)));
});

project.patch("/", async (req, res) => {
  const body = parse(z.object({ name }), req.body, res);
  if (!body) return;
  res.json(toResponse(await currentProject(res).update({ name: body.name })));
});

// Deletes the project with everything in it: its workspaces, Forges, chats, keys,
// development variables and its files. Not while a Forge, app launch or chat is running.
project.delete("/", async (_req, res) => {
  const current = currentProject(res);
  try {
    await withRepositoryLock(async () => {
      const [workspaces, threads] = await Promise.all([
        Workspace.findAll({ where: { projectId: current.id }, attributes: ["issueId"] }),
        ProjectLeadThread.findAll({ where: { projectId: current.id }, attributes: ["id"] }),
      ]);
      if (
        workspaces.some(({ issueId }) => isForgeRunning(issueId) || workspaceApps.starting(issueId)) ||
        threads.some(({ id }) => isRunning(id))
      )
        throw new Error("Pause its running Forges, app launches and chats first");
      for (const { issueId } of workspaces) await deleteWorkspace(issueId);
      for (const thread of threads) {
        await deleteThreadHistory(thread.id);
        await thread.destroy();
        forgetRun(thread.id);
      }
      await current.destroy();
      await rm(projectDir(current.id), { recursive: true, force: true });
    });
  } catch (err) {
    res.status(409).json({ error: `Couldn't delete the project: ${errorMessage(err)}` });
    return;
  }
  res.status(204).end();
});

project.get("/development-environment", async (_req, res) => {
  res.json(await developmentEnvironmentStatus(currentProject(res).id));
});

project.put("/development-environment", async (req, res) => {
  const body = parse(DEVELOPMENT_CHANGES, req.body, res, "Expected variable names and values, or explicit removals");
  if (!body) return;
  const { id } = currentProject(res);
  try {
    await saveDevelopmentEnvironment(id, body.variables);
  } catch {
    res
      .status(400)
      .json({ error: "Could not save development variables. Check names, reserved runtime variables and value lengths." });
    return;
  }
  res.json(await developmentEnvironmentStatus(id));
});

project.post("/development-environment/import", async (req, res) => {
  const body = parse(z.object({ content: z.string().max(80000) }), req.body, res, "Expected a .env file under 80 KB");
  if (!body) return;
  const { id } = currentProject(res);
  try {
    const variables = Object.entries(parseEnv(body.content)).map(([name, value]) => ({ name, value: value ?? "" }));
    if (!variables.length || variables.length > 100) throw new Error("Invalid variable count");
    await saveDevelopmentEnvironment(id, variables);
  } catch {
    res.status(400).json({ error: "Could not import .env. Check variable names, reserved runtime variables and value lengths." });
    return;
  }
  res.json(await developmentEnvironmentStatus(id));
});

project.use("/integrations", projectIntegrations);
project.use("/linear", projectLinear);
project.use("/project-lead", projectLead);
project.use("/database", database);
project.use("/openwiki", openwiki);
project.use("/openwiki", openwikiServe);
