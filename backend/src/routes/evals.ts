import { Router } from "express";
import { evalStatus, listBatches, listScenarios, runDiff, startEval, stopEval } from "../evals.js";

// zini's evals, at /api/evals (see evals.ts): the scenarios, the eval going on and its
// output, starting and stopping one, and past results.
export const evals = Router();

evals.get("/scenarios", (_req, res) => {
  res.json(listScenarios());
});

evals.get("/status", (_req, res) => {
  res.json(evalStatus());
});

// Starts { scenario, repeat } runs; answers once they've started. Its output and its end
// come through the eval.updated event.
evals.post("/runs", async (req, res) => {
  const { scenario, repeat } = req.body ?? {};
  if (typeof scenario !== "string" || typeof repeat !== "number") {
    res.status(400).json({ error: "Expected { scenario, repeat }" });
    return;
  }
  const error = await startEval(scenario, repeat);
  if (error) {
    res.status(409).json({ error });
    return;
  }
  res.status(202).end();
});

evals.post("/stop", (_req, res) => {
  if (!stopEval()) {
    res.status(409).json({ error: "No eval is running" });
    return;
  }
  res.status(202).end();
});

evals.get("/batches", (_req, res) => {
  res.json(listBatches());
});

// What one run changed in its repo, as a unified diff.
evals.get("/batches/:repo/:name/:batch/:run/diff", (req, res) => {
  const { repo, name, batch, run } = req.params;
  const diff = runDiff(repo, name, batch, run);
  if (diff === null) {
    res.status(404).json({ error: "No such run" });
    return;
  }
  res.type("text/plain").send(diff);
});
