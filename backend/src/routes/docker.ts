import { Router } from "express";
import { dockerStatus, startDocker } from "../workspaces/docker.js";
import { errorMessage } from "../core/errors.js";

// Docker on the machine running zini, at /api/docker: whether it's up, and starting it.
export const dockerRouter = Router();

dockerRouter.get("/", async (_req, res) => {
  res.json(await dockerStatus());
});

dockerRouter.post("/start", async (_req, res) => {
  try {
    await startDocker();
    res.json(await dockerStatus());
  } catch (err) {
    res.status(500).json({ error: `Couldn't start Docker: ${errorMessage(err)}` });
  }
});
