import { useIntegrations, useSettings } from "../api.ts";

// The one place that works out what's set up. The banner lists what's missing and
// the routes decide what to render, both from this, so they can't disagree.
// null while loading.
export function useSetup() {
  const integrations = useIntegrations();
  const settings = useSettings();

  if (!integrations.isSuccess || !settings.isSuccess) return null;

  const ready = {
    linear: integrations.data.linear.connected,
    openRouter: integrations.data.openrouter.connected,
    github: integrations.data.github.connected,
    model: Boolean(settings.data.productManagerModel),
    repo: Boolean(settings.data.githubRepo),
  };
  const missing = [];
  if (!ready.linear) missing.push("a Linear key");
  if (!ready.openRouter) missing.push("an OpenRouter key");
  if (!ready.github) missing.push("a GitHub token");
  if (!ready.model) missing.push("a model");
  if (!ready.repo) missing.push("a GitHub repository");
  return { ...ready, missing };
}
