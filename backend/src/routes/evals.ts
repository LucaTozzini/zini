import { Router } from "express";
import {
  batchLogFile,
  evalStatus,
  isEvalKind,
  listBatches,
  listScenarios,
  runDiff,
  startEval,
  stopEval,
} from "../evals/evals.js";

// zini's evals, at /api/evals (see evals.ts): the scenarios, the eval going on and its
// output, starting and stopping one, and past results. ?kind=agents (or kind in the body)
// is for agent tests instead of scenarios.
export const evals = Router();

const kindOf = (value: unknown) => (isEvalKind(value) ? value : "scenarios");

evals.get("/scenarios", (req, res) => {
  res.json(listScenarios(kindOf(req.query.kind)));
});

evals.get("/status", (_req, res) => {
  res.json(evalStatus());
});

// Starts { kind?, scenario, repeat } runs; answers once they've started. Its output and
// its end come through the eval.updated event.
evals.post("/runs", async (req, res) => {
  const { kind, scenario, repeat } = req.body ?? {};
  if (typeof scenario !== "string" || typeof repeat !== "number" || (kind !== undefined && !isEvalKind(kind))) {
    res.status(400).json({ error: "Expected { kind?, scenario, repeat }" });
    return;
  }
  const error = await startEval(kindOf(kind), scenario, repeat);
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

evals.get("/batches", (req, res) => {
  res.json(listBatches(kindOf(req.query.kind)));
});

evals.get("/batches/:repo/:name/:batch/log", (req, res) => {
  const { repo, name, batch } = req.params;
  const file = batchLogFile(kindOf(req.query.kind), repo, name, batch);
  if (!file) {
    res.status(404).json({ error: "No batch log" });
    return;
  }
  res.type("text/plain").sendFile(file);
});

// What one run changed in its repo, as a unified diff.
evals.get("/batches/:repo/:name/:batch/:run/diff", (req, res) => {
  const { repo, name, batch, run } = req.params;
  const diff = runDiff(kindOf(req.query.kind), repo, name, batch, run);
  if (diff === null) {
    res.status(404).json({ error: "No such run" });
    return;
  }
  res.type("text/plain").send(diff);
});
