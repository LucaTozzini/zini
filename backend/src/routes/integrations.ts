import { Router, type Response } from "express";
import { PROJECT_PROVIDERS, SHARED_PROVIDERS, type Provider } from "shared";
import { z } from "zod";
import {
  getIntegrations,
  getProjectIntegrations,
  isProjectProvider,
  isSharedProvider,
  removeKey,
  saveKeys,
} from "../integrations/integrations.js";
import { currentProject, parse } from "./http.js";
import { errorMessage } from "../core/errors.js";

// API keys to save, by service, e.g. { "linear": "lin_api_..." }. Google Search Console
// takes its key with the property it reads: { "googleSearchConsole": { key, site } }.
const key = z.string({ error: "API key is required" }).trim().min(1, "API key is required");
const apiKey = key.optional();
const searchConsole = z
  .object({ key, site: z.string({ error: "Property is required" }).trim().min(1, "Property is required") })
  .optional();
const apiKeys = (providers: readonly Provider[]) =>
  z.strictObject(
    Object.fromEntries(
      providers.map((provider) => [provider, provider === "googleSearchConsole" ? searchConsole : apiKey]),
    ) as Record<Provider, typeof apiKey | typeof searchConsole>,
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `Unknown integration "${issue.keys[0]}". Known: ${providers.join(", ")}`
          : "Expected an object of API keys",
    },
  );

// The services one set of keys is for: the shared ones at /api/integrations, or a
// project's at /api/projects/:projectId/integrations (projectId reads it from the request).
function integrationRoutes(
  providers: readonly Provider[],
  isProvider: (value: string) => boolean,
  projectId: (res: Response) => number | undefined,
) {
  const router = Router();
  const statuses = (res: Response) => {
    const id = projectId(res);
    return id === undefined ? getIntegrations() : getProjectIntegrations(id);
  };

  // Which services are connected, e.g. { linear: { connected: true, keyHint: "a1b" }, ... }.
  router.get("/", async (_req, res) => {
    res.json(await statuses(res));
  });

  // Saves the keys in the body, e.g. { "linear": "lin_api_..." }, after each service
  // accepts its key. The rest stay as they are. Returns all integrations.
  router.put("/", async (req, res) => {
    const keys = parse(apiKeys(providers), req.body, res);
    if (!keys) return;

    // A check that fails rather than rejecting the key (e.g. the service is unreachable)
    // says why, instead of a bare 500.
    let rejectedBy: string | null;
    try {
      rejectedBy = await saveKeys(keys, projectId(res));
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
      return;
    }
    if (rejectedBy) {
      res.status(400).json({ error: `${rejectedBy} rejected this API key` });
      return;
    }
    res.json(await statuses(res));
  });

  router.delete("/:provider", async (req, res) => {
    const { provider } = req.params;
    if (!isProvider(provider)) {
      res.status(404).json({ error: "Unknown integration" });
      return;
    }
    await removeKey(provider as Provider, projectId(res));
    res.json(await statuses(res));
  });

  return router;
}

export const integrations = integrationRoutes(SHARED_PROVIDERS, isSharedProvider, () => undefined);
export const projectIntegrations = integrationRoutes(PROJECT_PROVIDERS, isProjectProvider, (res) => currentProject(res).id);
