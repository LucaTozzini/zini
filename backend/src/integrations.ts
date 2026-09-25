import { PROVIDERS, type Integrations, type Provider } from "shared";
import { testGitHubKey } from "./github.js";
import { testLinearKey } from "./linear.js";
import { Integration } from "./models/Integration.js";
import { testOpenRouterKey } from "./openrouter.js";

// Each service's display name, and a check that calls it with the key: true if it
// accepts the key, false if it rejects it. Adding a service means adding it here
// and to PROVIDERS in shared.
const SERVICES: Record<Provider, { name: string; testKey: (apiKey: string) => Promise<boolean> }> = {
  linear: { name: "Linear", testKey: testLinearKey },
  openrouter: { name: "OpenRouter", testKey: testOpenRouterKey },
  github: { name: "GitHub", testKey: testGitHubKey },
};

export const isProvider = (value: string): value is Provider =>
  (PROVIDERS as readonly string[]).includes(value);

export async function getIntegrations() {
  const rows = await Integration.findAll({ where: { provider: [...PROVIDERS] } });
  const integrations = Object.fromEntries(
    PROVIDERS.map((provider) => [provider, { connected: false }]),
  ) as Integrations;
  for (const row of rows) {
    integrations[row.provider as Provider] = { connected: true, keyHint: row.apiKey.slice(-3) };
  }
  return integrations;
}

// Checks every key with its service first, and saves none if any is rejected.
// Returns the name of the service that rejected its key, or null once saved.
export async function saveKeys(keys: Partial<Record<Provider, string>>) {
  const entries = Object.entries(keys) as [Provider, string][];
  for (const [provider, apiKey] of entries) {
    if (!(await SERVICES[provider].testKey(apiKey))) return SERVICES[provider].name;
  }
  await Promise.all(entries.map(([provider, apiKey]) => Integration.upsert({ provider, apiKey })));
  return null;
}

export async function removeKey(provider: Provider) {
  await Integration.destroy({ where: { provider } });
}
