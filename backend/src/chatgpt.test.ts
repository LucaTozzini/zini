import assert from "node:assert/strict";
import test from "node:test";

process.env.DB_PATH = ":memory:";
const { chatGptAccessToken, signOutChatGpt, CHATGPT_API } = await import("./chatgpt.js");
const { OAuthConnection } = await import("./models/OAuthConnection.js");

function connection() {
  return OAuthConnection.build({ provider: "chatgpt", clientId: "test-client", accessToken: "old-access",
    refreshToken: "old-refresh", idToken: "id-token", expiresAt: new Date(0), email: null });
}

test("concurrent requests share a refresh with the correct resource and rotate credentials", async (t) => {
  const row = connection();
  t.mock.method(OAuthConnection, "findByPk", async () => row);
  t.mock.method(row, "update", async (values: object) => Object.assign(row, values));
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests++;
    const form = init.body as URLSearchParams;
    assert.equal(form.get("resource"), CHATGPT_API);
    assert.equal(form.get("refresh_token"), "old-refresh");
    assert.equal(form.get("client_id"), "test-client");
    await waiting;
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600,
      earliest_refresh_at: 2_000_000_000 });
  });
  const first = chatGptAccessToken();
  const second = chatGptAccessToken();
  release();
  assert.deepEqual(await Promise.all([first, second]), ["new-access", "new-access"]);
  assert.equal(requests, 1);
  assert.equal(row.refreshToken, "new-refresh");
  assert.equal(row.earliestRefreshAt?.getTime(), 2_000_000_000_000);
  assert.equal(await chatGptAccessToken(), "new-access");
  assert.equal(requests, 1);
});

test("near-expiry access tokens remain usable during the persisted cooldown", async (t) => {
  const row = connection();
  row.expiresAt = new Date(Date.now() + 120_000);
  row.earliestRefreshAt = new Date(Date.now() + 60_000);
  t.mock.method(OAuthConnection, "findByPk", async () => row);
  const requested = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not refresh"); });
  assert.equal(await chatGptAccessToken(), "old-access");
  assert.equal(await chatGptAccessToken(), "old-access");
  assert.equal(requested.mock.callCount(), 0);
});

test("an expired access token is never used during cooldown and credentials are retained", async (t) => {
  const row = connection();
  row.earliestRefreshAt = new Date(Date.now() + 60_000);
  t.mock.method(OAuthConnection, "findByPk", async () => row);
  const destroyed = t.mock.method(row, "destroy", async () => {});
  const requested = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not refresh"); });
  await assert.rejects(chatGptAccessToken(), /access token has expired/);
  assert.equal(requested.mock.callCount(), 0);
  assert.equal(destroyed.mock.callCount(), 0);
});

test("a cooldown rejection retains tokens and suppresses subsequent refresh requests", async (t) => {
  const row = connection();
  row.expiresAt = new Date(Date.now() + 120_000);
  t.mock.method(OAuthConnection, "findByPk", async () => row);
  t.mock.method(row, "update", async (values: object) => Object.assign(row, values));
  const destroyed = t.mock.method(row, "destroy", async () => {});
  const retryAt = Math.ceil((Date.now() + 90_000) / 1000);
  const requested = t.mock.method(globalThis, "fetch", async () => Response.json({
    error: "refresh_cooldown", earliest_refresh_at: retryAt,
  }, { status: 400, headers: { "Retry-After": "90" } }));
  assert.equal(await chatGptAccessToken(), "old-access");
  assert.ok(row.earliestRefreshAt!.getTime() >= retryAt * 1000);
  assert.equal(await chatGptAccessToken(), "old-access");
  assert.equal(requested.mock.callCount(), 1);
  assert.equal(destroyed.mock.callCount(), 0);
});

test("a terminal refresh error clears unusable credentials", async (t) => {
  const row = connection();
  t.mock.method(OAuthConnection, "findByPk", async () => row);
  const destroyed = t.mock.method(row, "destroy", async () => {});
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
  await assert.rejects(chatGptAccessToken(), /sign-in has expired/);
  assert.equal(destroyed.mock.callCount(), 1);
});

test("a client configuration error retains credentials", async (t) => {
  const row = connection();
  t.mock.method(OAuthConnection, "findByPk", async () => row);
  const destroyed = t.mock.method(row, "destroy", async () => {});
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "invalid_client" }, { status: 401 }));
  await assert.rejects(chatGptAccessToken(), /invalid_client/);
  assert.equal(destroyed.mock.callCount(), 0);
});

test("startup adds cooldown storage to an existing database without losing its connection", async () => {
  const { sequelize, initDb } = await import("./db.js");
  await OAuthConnection.sync();
  await OAuthConnection.create({ provider: "chatgpt", clientId: "saved-client", accessToken: "saved-access",
    refreshToken: "saved-refresh", idToken: "saved-id", expiresAt: new Date(Date.now() + 3600_000), email: null });
  await sequelize.getQueryInterface().removeColumn("oauth_connections", "earliestRefreshAt");
  await initDb();
  await initDb();
  const row = await OAuthConnection.findByPk("chatgpt");
  assert.equal(row?.accessToken, "saved-access");
  assert.equal(row?.earliestRefreshAt, null);
  await row?.update({ earliestRefreshAt: new Date(2_000_000_000_000) });
  assert.equal((await OAuthConnection.findByPk("chatgpt"))?.earliestRefreshAt?.getTime(), 2_000_000_000_000);
  await sequelize.close();
});

test("sign-out revokes the renewable session before deleting local credentials", async (t) => {
  const row = connection();
  t.mock.method(OAuthConnection, "findByPk", async () => row);
  let revoked = false;
  const destroyed = t.mock.method(OAuthConnection, "destroy", async () => {
    assert.ok(revoked);
    return 1;
  });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("openid-configuration")) return Response.json({ revocation_endpoint: "https://auth.openai.com/revoke" });
    assert.equal(url, "https://auth.openai.com/revoke");
    assert.equal(init?.method, "POST");
    const form = init?.body as URLSearchParams;
    assert.equal(form.get("token"), "old-refresh");
    assert.equal(form.get("token_type_hint"), "refresh_token");
    assert.equal(form.get("client_id"), "test-client");
    revoked = true;
    return new Response(null, { status: 200 });
  });
  await signOutChatGpt();
  assert.equal(destroyed.mock.callCount(), 1);
});

test("failed revocation retains credentials for retry", async (t) => {
  t.mock.method(OAuthConnection, "findByPk", async () => connection());
  const destroyed = t.mock.method(OAuthConnection, "destroy", async () => 1);
  t.mock.method(globalThis, "fetch", async (url: string) => url.endsWith("openid-configuration")
    ? Response.json({ revocation_endpoint: "https://auth.openai.com/revoke" })
    : new Response(null, { status: 503 }));
  await assert.rejects(signOutChatGpt(), /couldn't revoke/);
  assert.equal(destroyed.mock.callCount(), 0);
});
