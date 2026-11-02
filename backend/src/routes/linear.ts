import { InvalidInputLinearError } from "@linear/sdk";
import { Router, type Response } from "express";
import { STATUS_TYPES } from "shared";
import { z } from "zod";
import { fetchLinearIssue, fetchLinearIssues, fetchLinearTeams, getLinearClient } from "../integrations/linear.js";
import { currentProject, parse } from "./http.js";

// The Linear client, or null after sending a 409.
async function linearClient(res: Response) {
  const client = await getLinearClient();
  if (!client) res.status(409).json({ error: "Linear isn't connected" });
  return client;
}

// The Linear workspace, at /api/linear: its teams, for choosing a project's, and any
// issue by id.
export const linear = Router();

linear.get("/teams", async (_req, res) => {
  const client = await linearClient(res);
  if (!client) return;
  const { teams } = await fetchLinearTeams(client);
  res.json(teams.map(({ id, key, name }) => ({ id, key, name })));
});

// One issue with its details, by identifier (e.g. ZIN-4) or id.
linear.get("/issues/:id", async (req, res) => {
  const client = await linearClient(res);
  if (!client) return;

  try {
    res.json(await fetchLinearIssue(client, req.params.id));
  } catch (err) {
    // What Linear throws for an issue that doesn't exist.
    if (err instanceof InvalidInputLinearError) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    throw err;
  }
});

// ?status=unstarted,started: the status types to filter by.
const issuesQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",") : []))
    .pipe(z.array(z.enum(STATUS_TYPES))),
});

// The project's team's issues, at /api/projects/:projectId/linear.
export const projectLinear = Router();

// Up to 250 issues, most recently updated first. ?status=unstarted,started filters by status type.
projectLinear.get("/issues", async (req, res) => {
  const query = parse(issuesQuery, req.query, res, `status must be one of: ${STATUS_TYPES.join(", ")}`);
  if (!query) return;
  const client = await linearClient(res);
  if (!client) return;
  res.json({ issues: await fetchLinearIssues(client, currentProject(res).linearTeamId, query.status) });
});
