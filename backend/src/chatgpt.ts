import { createHash, createPublicKey, randomBytes, randomUUID, verify, type JsonWebKey } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { ChatGptStatus } from "shared";
import { sendEvent } from "./events.js";
import { OAuthConnection } from "./models/OAuthConnection.js";
import { Setting } from "./models/Setting.js";

// Sign in with ChatGPT: zini signs in to the user's ChatGPT plan (Plus or Pro) and runs
// models on it, through OpenAI's plan usage for open-source apps
// (https://developers.openai.com/siwc/token-sharing-open-source). The sign-in is OAuth
// with PKCE and a callback to 127.0.0.1, so it's finished in a browser on this machine.
// The tokens are kept in the oauth_connections table; only this server refreshes them.

const AUTH = "https://auth.openai.com";
export const CHATGPT_API = "https://api.openai.com/v1";
const PROVIDER = "chatgpt";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPE = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
// Only the port may change between sign-ins: the rest of the callback stays the same.
const PORTS = [1455, 1456, 1457];
const SIGN_IN_MINUTES = 10;

const notify = () => sendEvent({ type: "chatgpt.updated" });
const random = () => randomBytes(32).toString("base64url");

export async function chatGptStatus(): Promise<ChatGptStatus> {
  const row = await OAuthConnection.findByPk(PROVIDER);
  return row ? { connected: true, email: row.email ?? undefined } : { connected: false };
}

let signingOut: Promise<void> | null = null;

export function signOutChatGpt() {
  return signingOut ??= revokeSession().finally(() => { signingOut = null; });
}

async function revokeSession() {
  stopSignIn();
  // Let a rotating refresh finish before revoking its replacement.
  await refreshing?.catch(() => {});
  const row = await OAuthConnection.findByPk(PROVIDER);
  if (row) {
    const config = await fetch(`${AUTH}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) });
    if (!config.ok) throw new Error("Couldn't discover OpenAI's revocation endpoint; try signing out again");
    const { revocation_endpoint } = await config.json() as { revocation_endpoint: string };
    const revoked = await fetch(revocation_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: row.refreshToken, token_type_hint: "refresh_token", client_id: row.clientId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!revoked.ok) throw new Error(`OpenAI couldn't revoke the session (${revoked.status}); try signing out again`);
  }
  await OAuthConnection.destroy({ where: { provider: PROVIDER } });
  notify();
}

// ---- Signing in ------------------------------------------------------------------

// OpenAI wants one stable id per installation; made once and kept with the settings.
async function hostId() {
  const row = await Setting.findByPk("chatgptHostId");
  if (row) return row.value;
  const id = `urn:uuid:${randomUUID()}`;
  await Setting.create({ key: "chatgptHostId", value: id });
  return id;
}

// The sign-in waiting for its callback, if any. Starting another replaces it.
let pending: { server: Server; timer: NodeJS.Timeout } | null = null;

function stopSignIn() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.server.close();
  pending = null;
}

// The first of PORTS that's free on 127.0.0.1.
async function listen() {
  for (const port of PORTS) {
    const server = createServer();
    const listening = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (listening) return { server, port };
  }
  throw new Error(`Ports ${PORTS.join(", ")} are all in use, so the sign-in can't receive its callback`);
}

// Starts a sign-in and returns the URL to open, in a browser on this machine. Its
// callback finishes it, within SIGN_IN_MINUTES.
export async function startSignIn() {
  stopSignIn();
  const previous = await OAuthConnection.findByPk(PROVIDER);
  const { server, port } = await listen();
  const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
  const verifier = random();
  const state = random();
  const nonce = random();

  const url = new URL(`${AUTH}/api/accounts/authorize`);
  const params: Record<string, string> = {
    // A first sign-in registers zini; later ones reuse the client id it was issued.
    client_id: previous?.clientId ?? "dynamic_agent_client",
    ...(previous ? { id_token_hint: previous.idToken } : { agent_name_hint: "zini" }),
    ext_agent_host_id: await hostId(),
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPE,
    resource: CHATGPT_API,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  server.on("request", (req, res) => {
    const callback = new URL(req.url ?? "/", redirectUri);
    if (callback.pathname !== "/auth/callback") {
      res.writeHead(404).end();
      return;
    }
    finishSignIn(Object.fromEntries(callback.searchParams), { state, verifier, nonce, redirectUri, previous })
      .then(
        () => "Signed in to ChatGPT. You can close this tab.",
        (error: unknown) => `Couldn't sign in to ChatGPT: ${error instanceof Error ? error.message : String(error)}`,
      )
      .then((message) => {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(message);
        stopSignIn();
      });
  });
  pending = { server, timer: setTimeout(stopSignIn, SIGN_IN_MINUTES * 60_000) };
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  scope?: string;
  earliest_refresh_at?: number | string;
};

// OAuth timestamps may be Unix seconds or a serialized date.
function refreshTime(value: number | string | undefined): Date | null {
  if (value === undefined) return null;
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) ? numeric * 1000 : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function finishSignIn(
  query: Record<string, string>,
  sent: { state: string; verifier: string; nonce: string; redirectUri: string; previous: OAuthConnection | null },
) {
  if (query.error) throw new Error(query.error_description ?? query.error);
  if (query.state !== sent.state) throw new Error("the sign-in didn't match the one zini started");
  const clientId = query.client_id ?? sent.previous?.clientId;
  if (!query.code || !clientId) throw new Error("the callback had no code or client id");

  const tokens = await requestTokens({
    grant_type: "authorization_code",
    client_id: clientId,
    code: query.code,
    code_verifier: sent.verifier,
    redirect_uri: sent.redirectUri,
    resource: CHATGPT_API,
  });
  if (!tokens.scope?.split(" ").includes(PLAN_SCOPE)) {
    throw new Error("this ChatGPT account can't use its plan in other apps (that needs Plus or Pro)");
  }
  if (!tokens.refresh_token || !tokens.id_token) throw new Error("OpenAI didn't return a refresh and ID token");
  const claims = await verifyIdToken(tokens.id_token, clientId, sent.nonce);

  await OAuthConnection.upsert({
    provider: PROVIDER,
    clientId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    earliestRefreshAt: refreshTime(tokens.earliest_refresh_at),
    email: typeof claims.email === "string" ? claims.email : null,
  });
  notify();
}

async function requestTokens(form: Record<string, string>) {
  const res = await fetch(`${AUTH}/api/accounts/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw Object.assign(new Error(`OpenAI's token endpoint answered ${res.status}: ${body.error_description ?? body.error ?? ""}`), {
      status: res.status,
      code: body.error,
      earliestRefreshAt: refreshTime(body.earliest_refresh_at),
      retryAfter: res.headers.get("Retry-After"),
    });
  }
  return body;
}

// Checks the ID token's signature against OpenAI's published keys, and that it was
// issued to zini for this sign-in. Returns its claims.
async function verifyIdToken(idToken: string, clientId: string, nonce: string) {
  const [header, payload, signature] = idToken.split(".");
  if (!header || !payload || !signature) throw new Error("the ID token is malformed");
  const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>;
  const { alg, kid } = decode(header);
  if (alg !== "RS256") throw new Error(`the ID token is signed with ${String(alg)}, not RS256`);

  const config = (await (await fetch(`${AUTH}/.well-known/openid-configuration`)).json()) as { jwks_uri: string };
  const { keys } = (await (await fetch(config.jwks_uri)).json()) as { keys: (JsonWebKey & { kid?: string })[] };
  const key = keys.find((k) => k.kid === kid);
  if (!key) throw new Error("the ID token's signing key isn't one of OpenAI's");
  const valid = verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), createPublicKey({ key, format: "jwk" }),
    Buffer.from(signature, "base64url"));
  if (!valid) throw new Error("the ID token's signature is invalid");

  const claims = decode(payload);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== AUTH) throw new Error("the ID token wasn't issued by OpenAI");
  if (!audience.includes(clientId)) throw new Error("the ID token wasn't issued to zini");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new Error("the ID token has expired");
  if (claims.nonce !== nonce) throw new Error("the ID token is from another sign-in");
  return claims;
}

// ---- Using the plan --------------------------------------------------------------

// The refresh in progress, if any. Refresh tokens can only be used once, so calls that
// find the token expiring while one runs share it instead of each refreshing.
let refreshing: Promise<OAuthConnection> | null = null;

// Refresh near expiry, but never before the server's cooldown ends.
export async function chatGptAccessToken() {
  const row = await OAuthConnection.findByPk(PROVIDER);
  if (signingOut) throw new Error("zini is signing out of ChatGPT");
  if (!row) throw new Error("zini isn't signed in to ChatGPT: sign in in Settings");
  if (row.expiresAt.getTime() - Date.now() > 5 * 60_000) return row.accessToken;
  if (row.earliestRefreshAt && row.earliestRefreshAt.getTime() > Date.now()) {
    if (row.expiresAt.getTime() > Date.now()) return row.accessToken;
    throw new Error(`ChatGPT refresh is available at ${row.earliestRefreshAt.toISOString()}; the access token has expired`);
  }
  refreshing ??= refresh(row).finally(() => (refreshing = null));
  return (await refreshing).accessToken;
}

async function refresh(row: OAuthConnection) {
  try {
    const tokens = await requestTokens({ grant_type: "refresh_token", client_id: row.clientId, refresh_token: row.refreshToken,
      resource: CHATGPT_API });
    return await row.update({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? row.refreshToken,
      idToken: tokens.id_token ?? row.idToken,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      earliestRefreshAt: refreshTime(tokens.earliest_refresh_at),
    });
  } catch (error) {
    const failure = error as { code?: string; earliestRefreshAt?: Date | null; retryAfter?: string | null };
    // Cooldowns and configuration failures don't invalidate a rotating token.
    if (["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
      "refresh_token_invalidated", "refresh_token_reused"].includes(failure.code ?? "")) {
      await row.destroy();
      notify();
      throw new Error("zini's ChatGPT sign-in has expired: sign in again in Settings", { cause: error });
    }
    if (failure.code !== "invalid_client") {
      const retryAfter = failure.retryAfter;
      const retryAt = retryAfter ? new Date(Number.isFinite(Number(retryAfter))
        ? Date.now() + Number(retryAfter) * 1000 : retryAfter) : null;
      const earliestRefreshAt = new Date(Math.max(Date.now() + 60_000,
        failure.earliestRefreshAt?.getTime() ?? 0,
        retryAt && Number.isFinite(retryAt.getTime()) ? retryAt.getTime() : 0));
      await row.update({ earliestRefreshAt });
      if (row.expiresAt.getTime() > Date.now()) return row;
    }
    throw error;
  }
}

// The models the user's plan offers, by slug, with the names ChatGPT shows.
export async function chatGptModels() {
  const res = await fetch(`${CHATGPT_API}/models`, { headers: { Authorization: `Bearer ${await chatGptAccessToken()}` } });
  if (!res.ok) throw new Error(`OpenAI's model list answered ${res.status}`);
  const body = (await res.json()) as { models?: { slug: string; display_name?: string; visibility?: string }[] };
  return (body.models ?? [])
    .filter((model) => (model.visibility ?? "list") === "list")
    .map((model) => ({ slug: model.slug, name: model.display_name ?? model.slug }));
}
