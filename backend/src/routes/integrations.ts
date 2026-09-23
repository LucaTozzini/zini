import { Router } from "express";
import { STATUS_TYPES, type StatusType } from "shared";
import { fetchLinearIssues, getLinearClient, getLinearKey, testLinearKey } from "../linear.js";
import { Integration } from "../models/Integration.js";

const isStatusType = (s: string): s is StatusType =>
  (STATUS_TYPES as readonly string[]).includes(s);

export const integrations = Router();

// Never send the full key; the last 3 characters are enough to recognise it.
function linearStatus(apiKey: string | null, valid = true) {
  return apiKey
    ? { connected: true, valid, keyHint: apiKey.slice(-3) }
    : { connected: false };
}

integrations.get("/linear", async (_req, res) => {
  const apiKey = await getLinearKey();
  res.json(linearStatus(apiKey, apiKey ? await testLinearKey(apiKey) : true));
});

integrations.put("/linear", async (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey) {
    res.status(400).json({ error: "API key is required" });
    return;
  }

  if (!(await testLinearKey(apiKey))) {
    res.status(400).json({ error: "Linear rejected this API key" });
    return;
  }

  await Integration.upsert({ provider: "linear", apiKey });
  res.json(linearStatus(apiKey));
});

integrations.delete("/linear", async (_req, res) => {
  await Integration.destroy({ where: { provider: "linear" } });
  res.json(linearStatus(null));
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
