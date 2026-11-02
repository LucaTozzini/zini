import {
  PROJECT_PROVIDERS,
  SHARED_PROVIDERS,
  type Integrations,
  type ProjectProvider,
  type Provider,
  type SearchConsoleConnection,
} from "shared";
import { testGitHubKey } from "./github.js";
import { testLinearKey } from "./linear.js";
import { testGoogleDriveKey } from "./googleDrive.js";
import { testGoogleSearchConsole } from "./googleSearchConsole.js";
import { serviceAccountEmail } from "./googleServiceAccount.js";
import { postgresHint, testPostgresUrl } from "./postgres.js";
import { testPapertrailToken } from "./papertrail.js";
import { Integration } from "../models/Integration.js";
import { Project } from "../models/Project.js";
import { ProjectIntegration } from "../models/ProjectIntegration.js";
import { testOpenRouterKey } from "../providers/openrouter.js";

// Each service's display name, and a check that calls it with the key (and Google Search
// Console's, with its site): true if it accepts the key, false if it rejects it. Adding a
// service means adding it here and to SHARED_PROVIDERS or PROJECT_PROVIDERS in shared.
const SERVICES: Record<Provider, { name: string; testKey: (apiKey: string, site?: string) => Promise<boolean> }> = {
  linear: { name: "Linear", testKey: testLinearKey },
  openrouter: { name: "OpenRouter", testKey: testOpenRouterKey },
  github: { name: "GitHub", testKey: testGitHubKey },
  postgres: { name: "Postgres database", testKey: testPostgresUrl },
  googleDrive: { name: "Google Drive", testKey: testGoogleDriveKey },
  googleSearchConsole: { name: "Google Search Console", testKey: (key, site = "") => testGoogleSearchConsole(key, site) },
  papertrail: { name: "Papertrail", testKey: testPapertrailToken },
};

export const isSharedProvider = (value: string): value is (typeof SHARED_PROVIDERS)[number] =>
  (SHARED_PROVIDERS as readonly string[]).includes(value);
export const isProjectProvider = (value: string): value is ProjectProvider =>
  (PROJECT_PROVIDERS as readonly string[]).includes(value);

// A database is shown by who it connects as and where, never its password, and Google's
// services by their service account's email.
const keyHint = (provider: string, apiKey: string) =>
  provider === "postgres"
    ? postgresHint(apiKey)
    : provider === "googleDrive" || provider === "googleSearchConsole"
      ? serviceAccountEmail(apiKey)
      : apiKey.slice(-3);

// With site, Google Search Console's status shows its property.
function statuses<P extends Provider>(
  providers: readonly P[],
  rows: { provider: string; apiKey: string }[],
  site?: string | null,
) {
  const integrations = Object.fromEntries(providers.map((provider) => [provider, { connected: false }])) as Integrations<P>;
  for (const row of rows)
    integrations[row.provider as P] = {
      connected: true,
      keyHint: keyHint(row.provider, row.apiKey),
      ...(row.provider === "googleSearchConsole" && site && { site }),
    };
  return integrations;
}

// The shared services, or with projectId, that project's.
export async function getIntegrations() {
  return statuses(SHARED_PROVIDERS, await Integration.findAll({ where: { provider: [...SHARED_PROVIDERS] } }));
}
export async function getProjectIntegrations(projectId: number) {
  const [rows, project] = await Promise.all([
    ProjectIntegration.findAll({ where: { projectId, provider: [...PROJECT_PROVIDERS] } }),
    Project.findByPk(projectId),
  ]);
  return statuses(PROJECT_PROVIDERS, rows, project?.googleSearchConsoleSite);
}

// Checks every key with its service first, and saves none if any is rejected: shared
// keys, or with projectId, that project's. Returns the name of the service that rejected
// its key, or null once saved. Google Search Console's comes with its site, which is
// saved on the project.
export async function saveKeys(keys: Partial<Record<Provider, string | SearchConsoleConnection>>, projectId?: number) {
  const entries = Object.entries(keys).map(([provider, value]) => ({
    provider: provider as Provider,
    ...(typeof value === "string" ? { apiKey: value, site: null } : { apiKey: value.key, site: value.site }),
  }));
  for (const { provider, apiKey, site } of entries) {
    if (!(await SERVICES[provider].testKey(apiKey, site ?? undefined))) return SERVICES[provider].name;
  }
  await Promise.all(
    entries.map(async ({ provider, apiKey, site }) => {
      if (projectId === undefined) return Integration.upsert({ provider, apiKey });
      await ProjectIntegration.upsert({ projectId, provider, apiKey });
      if (site) await Project.update({ googleSearchConsoleSite: site }, { where: { id: projectId } });
    }),
  );
  return null;
}

export async function removeKey(provider: Provider, projectId?: number) {
  if (projectId === undefined) await Integration.destroy({ where: { provider } });
  else await ProjectIntegration.destroy({ where: { projectId, provider } });
  if (projectId !== undefined && provider === "googleSearchConsole")
    await Project.update({ googleSearchConsoleSite: null }, { where: { id: projectId } });
}
