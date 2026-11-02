import { Router } from "express";
import { errorMessage } from "../core/errors.js";
import { databaseSchema } from "../integrations/postgres.js";
import { getProjectKey } from "../models/ProjectIntegration.js";
import { currentProject } from "./http.js";

export const database = Router();

// The project's connected Postgres database's tables and the foreign keys between them, read-only.
// 404 when no database is connected; 502 with what went wrong when it can't be read.
database.get("/schema", async (_req, res) => {
  const url = await getProjectKey(currentProject(res).id, "postgres");
  if (!url) {
    res.status(404).json({ error: "No Postgres database is connected. Connect one in the project's settings." });
    return;
  }
  try {
    res.json(await databaseSchema(url));
  } catch (error) {
    res.status(502).json({ error: `Couldn't read the database: ${errorMessage(error)}` });
  }
});
