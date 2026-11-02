import { PROJECT_PROVIDERS, SHARED_PROVIDERS, type Integrations, type ProjectProvider, type Provider } from "shared";
import { testGitHubKey } from "./github.js";
import { testLinearKey } from "./linear.js";
import { googleDriveHint, testGoogleDriveKey } from "./googleDrive.js";
import { postgresHint, testPostgresUrl } from "./postgres.js";
import { testPapertrailToken } from "./papertrail.js";
import { Integration } from "../models/Integration.js";
import { ProjectIntegration } from "../models/ProjectIntegration.js";
import { testOpenRouterKey } from "../providers/openrouter.js";

// Each service's display name, and a check that calls it with the key: true if it
// accepts the key, false if it rejects it. Adding a service means adding it here
// and to SHARED_PROVIDERS or PROJECT_PROVIDERS in shared.
const SERVICES: Record<Provider, { name: string; testKey: (apiKey: string) => Promise<boolean> }> = {
  linear: { name: "Linear", testKey: testLinearKey },
  openrouter: { name: "OpenRouter", testKey: testOpenRouterKey },
  github: { name: "GitHub", testKey: testGitHubKey },
  postgres: { name: "Postgres database", testKey: testPostgresUrl },
  googleDrive: { name: "Google Drive", testKey: testGoogleDriveKey },
  papertrail: { name: "Papertrail", testKey: testPapertrailToken },
};

export const isSharedProvider = (value: string): value is (typeof SHARED_PROVIDERS)[number] =>
  (SHARED_PROVIDERS as readonly string[]).includes(value);
export const isProjectProvider = (value: string): value is ProjectProvider =>
  (PROJECT_PROVIDERS as readonly string[]).includes(value);

// A database is shown by who it connects as and where, never its password, and Google
// Drive by its service account's email.
const keyHint = (provider: string, apiKey: string) =>
  provider === "postgres" ? postgresHint(apiKey) : provider === "googleDrive" ? googleDriveHint(apiKey) : apiKey.slice(-3);

function statuses<P extends Provider>(providers: readonly P[], rows: { provider: string; apiKey: string }[]) {
  const integrations = Object.fromEntries(providers.map((provider) => [provider, { connected: false }])) as Integrations<P>;
  for (const row of rows) integrations[row.provider as P] = { connected: true, keyHint: keyHint(row.provider, row.apiKey) };
  return integrations;
}

// The shared services, or with projectId, that project's.
export async function getIntegrations() {
  return statuses(SHARED_PROVIDERS, await Integration.findAll({ where: { provider: [...SHARED_PROVIDERS] } }));
}
export async function getProjectIntegrations(projectId: number) {
  return statuses(
    PROJECT_PROVIDERS,
    await ProjectIntegration.findAll({ where: { projectId, provider: [...PROJECT_PROVIDERS] } }),
  );
}

// Checks every key with its service first, and saves none if any is rejected: shared
// keys, or with projectId, that project's. Returns the name of the service that rejected
// its key, or null once saved.
export async function saveKeys(keys: Partial<Record<Provider, string>>, projectId?: number) {
  const entries = Object.entries(keys) as [Provider, string][];
  for (const [provider, apiKey] of entries) {
    if (!(await SERVICES[provider].testKey(apiKey))) return SERVICES[provider].name;
  }
  await Promise.all(
    entries.map(([provider, apiKey]) =>
      projectId === undefined
        ? Integration.upsert({ provider, apiKey })
        : ProjectIntegration.upsert({ projectId, provider, apiKey }),
    ),
  );
  return null;
}

export async function removeKey(provider: Provider, projectId?: number) {
  if (projectId === undefined) await Integration.destroy({ where: { provider } });
  else await ProjectIntegration.destroy({ where: { projectId, provider } });
}
