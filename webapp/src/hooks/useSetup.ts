import { useChatGpt } from "../api/chatgpt.ts";
import { useIntegrations } from "../api/integrations.ts";
import { useSettings } from "../api/settings.ts";

// The one place that works out what's set up. The banner lists what's missing and
// the routes decide what to render, both from this, so they can't disagree.
// null while loading.
export function useSetup() {
  const integrations = useIntegrations();
  const settings = useSettings();
  const chatGpt = useChatGpt();

  if (!integrations.isSuccess || !settings.isSuccess || !chatGpt.isSuccess) return null;

  // The product manager's model runs on its provider: OpenRouter, or the ChatGPT plan.
  const onChatGpt = settings.data.productManagerProvider === "chatgpt";
  const ready = {
    linear: integrations.data.linear.connected,
    modelProvider: onChatGpt ? chatGpt.data.connected : integrations.data.openrouter.connected,
    github: integrations.data.github.connected,
    model: Boolean(settings.data.productManagerModel),
    repo: Boolean(settings.data.githubRepo),
  };
  const missing = [];
  if (!ready.linear) missing.push("a Linear key");
  if (!ready.modelProvider) missing.push(onChatGpt ? "a ChatGPT sign-in" : "an OpenRouter key");
  if (!ready.github) missing.push("a GitHub token");
  if (!ready.model) missing.push("a model");
  if (!ready.repo) missing.push("a GitHub repository");
  return { ...ready, missing };
}
