import { Router } from "express";
import { PROVIDERS, STATUS_TYPES, type Provider } from "shared";
import { z } from "zod";
import { getIntegrations, isProvider, removeKey, saveKeys } from "../integrations/integrations.js";
import { InvalidInputLinearError } from "@linear/sdk";
import { fetchLinearIssue, fetchLinearIssues, getLinearClient } from "../integrations/linear.js";
import { parse } from "./http.js";

export const integrations = Router();

// API keys to save, by service, e.g. { "linear": "lin_api_..." }.
const apiKey = z.string({ error: "API key is required" }).trim().min(1, "API key is required").optional();
const apiKeys = z.strictObject(
  Object.fromEntries(PROVIDERS.map((provider) => [provider, apiKey])) as Record<Provider, typeof apiKey>,
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `Unknown integration "${issue.keys[0]}". Known: ${PROVIDERS.join(", ")}`
        : "Expected an object of API keys",
  },
);

// ?status=unstarted,started: the status types to filter by.
const issuesQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",") : []))
    .pipe(z.array(z.enum(STATUS_TYPES))),
});

// Which services are connected, e.g. { linear: { connected: true, keyHint: "a1b" }, ... }.
integrations.get("/", async (_req, res) => {
  res.json(await getIntegrations());
});

// Saves the keys in the body, e.g. { "linear": "lin_api_..." }, after each service
// accepts its key. The rest stay as they are. Returns all integrations.
integrations.put("/", async (req, res) => {
  const keys = parse(apiKeys, req.body, res);
  if (!keys) return;

  const rejectedBy = await saveKeys(keys);
  if (rejectedBy) {
    res.status(400).json({ error: `${rejectedBy} rejected this API key` });
    return;
  }
  res.json(await getIntegrations());
});

integrations.delete("/:provider", async (req, res) => {
  if (!isProvider(req.params.provider)) {
    res.status(404).json({ error: "Unknown integration" });
    return;
  }
  await removeKey(req.params.provider);
  res.json(await getIntegrations());
});

// Up to 250 issues, most recently updated first. ?status=unstarted,started filters by status type.
integrations.get("/linear/issues", async (req, res) => {
  const query = parse(issuesQuery, req.query, res, `status must be one of: ${STATUS_TYPES.join(", ")}`);
  if (!query) return;
  const { status } = query;

  const client = await getLinearClient();
  if (!client) {
    res.status(409).json({ error: "Linear isn't connected" });
    return;
  }

  res.json({ issues: await fetchLinearIssues(client, status) });
});

// One issue with its details, by identifier (e.g. ZIN-4) or id.
integrations.get("/linear/issues/:id", async (req, res) => {
  const client = await getLinearClient();
  if (!client) {
    res.status(409).json({ error: "Linear isn't connected" });
    return;
  }

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
