import { Router } from "express";
import { PROVIDERS, STATUS_TYPES, type Provider, type StatusType } from "shared";
import { getIntegrations, isProvider, removeKey, saveKeys } from "../integrations.js";
import { InvalidInputLinearError } from "@linear/sdk";
import { fetchLinearIssue, fetchLinearIssues, getLinearClient } from "../linear.js";

const isStatusType = (s: string): s is StatusType =>
  (STATUS_TYPES as readonly string[]).includes(s);

export const integrations = Router();

// Which services are connected, e.g. { linear: { connected: true, keyHint: "a1b" }, ... }.
integrations.get("/", async (_req, res) => {
  res.json(await getIntegrations());
});

// Saves the keys in the body, e.g. { "linear": "lin_api_..." }, after each service
// accepts its key. The rest stay as they are. Returns all integrations.
integrations.put("/", async (req, res) => {
  const body: unknown = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    res.status(400).json({ error: "Expected an object of API keys" });
    return;
  }

  const keys: Partial<Record<Provider, string>> = {};
  for (const [provider, value] of Object.entries(body)) {
    if (!isProvider(provider)) {
      res.status(400).json({ error: `Unknown integration "${provider}". Known: ${PROVIDERS.join(", ")}` });
      return;
    }
    const apiKey = typeof value === "string" ? value.trim() : "";
    if (!apiKey) {
      res.status(400).json({ error: "API key is required" });
      return;
    }
    keys[provider] = apiKey;
  }

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
  const status = typeof req.query.status === "string" ? req.query.status.split(",") : [];
  if (!status.every(isStatusType)) {
    res.status(400).json({ error: `status must be one of: ${STATUS_TYPES.join(", ")}` });
    return;
  }

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
