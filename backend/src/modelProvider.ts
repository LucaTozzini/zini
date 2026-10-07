import { ChatOpenAI } from "@langchain/openai";
import { CHATGPT_API, chatGptAccessToken } from "./chatgpt.js";
import { getKey } from "./models/Integration.js";
import { OAuthConnection } from "./models/OAuthConnection.js";
import { OPENROUTER_URL } from "./openrouter.js";
import { preserveChatGptOutput } from "./chatgptStream.js";

// Where a role's model runs: on OpenRouter with its key, or on the user's ChatGPT plan
// (see chatgpt.ts), with a token that's fetched, and refreshed, per request.
export type ModelConnection =
  | { provider: "openrouter"; key: string }
  | { provider: "chatgpt"; token: () => Promise<string> };

// The connection for a provider setting (OpenRouter when unset), or what's missing.
export async function loadConnection(provider: string | null): Promise<ModelConnection | string> {
  if (provider === "chatgpt") {
    return (await OAuthConnection.findByPk("chatgpt"))
      ? { provider: "chatgpt", token: chatGptAccessToken }
      : "ChatGPT isn't signed in";
  }
  const key = await getKey("openrouter");
  return key ? { provider: "openrouter", key } : "OpenRouter isn't connected";
}

export function chatModel(connection: ModelConnection, model: string, fields: { maxRetries?: number } = {}) {
  if (connection.provider === "openrouter") {
    return new ChatOpenAI({ model, apiKey: connection.key, ...fields, configuration: { baseURL: OPENROUTER_URL } });
  }
  // Plan usage takes the Responses API, streamed and not stored, and none of the
  // sampling or length options. The token goes on each request, so a long run keeps
  // working past its hour.
  return new ChatOpenAI({
    model,
    apiKey: "chatgpt-plan",
    useResponsesApi: true,
    streaming: true,
    zdrEnabled: true,
    ...fields,
    configuration: {
      baseURL: CHATGPT_API,
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${await connection.token()}`);
        return preserveChatGptOutput(await fetch(url, { ...init, headers }));
      },
    },
  });
}
