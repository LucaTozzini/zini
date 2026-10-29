import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { searchLogs, testPapertrailToken } from "./papertrail.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// The SolarWinds logs API, answering with body (or each of bodies in turn) and recording
// the requests it gets.
function stubSolarWinds(body: unknown, status = 200) {
  const bodies = Array.isArray(body) ? [...body] : null;
  const requests: { url: URL; auth: string | null }[] = [];
  globalThis.fetch = (async (url: URL, init?: RequestInit) => {
    requests.push({ url: new URL(url), auth: new Headers(init?.headers).get("Authorization") });
    return new Response(JSON.stringify(bodies ? bodies.shift() : body), { status });
  }) as typeof fetch;
  return requests;
}

const log = (time: string, message = "GET /quotes 200") => ({
  time,
  hostname: "renofiz",
  program: "app/web.1",
  severity: "INFO",
  message,
});

test("searches the window backward, newest first", async () => {
  const requests = stubSolarWinds({
    logs: [log("2026-10-29T13:59:00Z"), log("2026-10-29T13:30:00Z")],
    pageInfo: { nextPage: "/v1/logs?skipToken=abc&pageSize=200" },
  });
  const result = await searchLogs("token", { query: "status=500", to: "2026-10-29T14:00:00Z" });

  const { url, auth } = requests[0]!;
  assert.equal(auth, "Bearer token");
  assert.equal(url.origin + url.pathname, "https://api.na-01.cloud.solarwinds.com/v1/logs");
  assert.equal(url.searchParams.get("filter"), "status=500");
  assert.equal(url.searchParams.get("startTime"), "2026-10-29T13:00:00.000Z", "the hour before to");
  assert.equal(url.searchParams.get("endTime"), "2026-10-29T14:00:00.000Z");
  assert.equal(url.searchParams.get("direction"), "backward");
  assert.deepEqual(
    result.events.map((e) => e.time),
    ["2026-10-29T13:59:00Z", "2026-10-29T13:30:00Z"],
  );
  assert.equal(result.nextPage, "/v1/logs?skipToken=abc&pageSize=200");
});

test("follows a next page, but only the API's own", async () => {
  const requests = stubSolarWinds({ logs: [log("2026-10-29T12:00:00Z")], pageInfo: {} });
  const result = await searchLogs("token", { page: "/v1/logs?skipToken=abc&pageSize=200", query: "ignored" });
  assert.equal(requests[0]!.url.href, "https://api.na-01.cloud.solarwinds.com/v1/logs?skipToken=abc&pageSize=200");
  assert.equal(result.nextPage, undefined);

  await assert.rejects(searchLogs("token", { page: "https://example.com/v1/logs" }), /nextPage/);
  await assert.rejects(searchLogs("token", { page: "/v1/entities" }), /nextPage/);
});

test("follows empty pages until one has lines, newest first", async () => {
  const requests = stubSolarWinds([
    { logs: [], pageInfo: { nextPage: "/v1/logs?skipToken=1" } },
    { logs: [], pageInfo: { nextPage: "/v1/logs?skipToken=2" } },
    { logs: [log("2026-10-29T10:00:00Z"), log("2026-10-29T11:00:00Z")], pageInfo: { nextPage: "/v1/logs?skipToken=3" } },
  ]);
  const result = await searchLogs("token", { query: "error" });
  assert.deepEqual(
    requests.slice(1).map((r) => r.url.searchParams.get("skipToken")),
    ["1", "2"],
  );
  assert.deepEqual(
    result.events.map((e) => e.time),
    ["2026-10-29T11:00:00Z", "2026-10-29T10:00:00Z"],
  );
  assert.equal(result.nextPage, "/v1/logs?skipToken=3");

  // Ten empty pages: their next page is given back to carry on from.
  stubSolarWinds(Array.from({ length: 12 }, (_, i) => ({ logs: [], pageInfo: { nextPage: `/v1/logs?skipToken=${i + 1}` } })));
  const empty = await searchLogs("token", { query: "error" });
  assert.deepEqual(empty, { events: [], nextPage: "/v1/logs?skipToken=10" });
});

test("cuts long lines", async () => {
  stubSolarWinds({ logs: [log("2026-10-29T13:59:00Z", "x".repeat(5000))] });
  const [line] = (await searchLogs("token", {})).events;
  assert.equal(line!.message.length, 1001);
});

test("a rejected token is false, and a bad time says so", async () => {
  stubSolarWinds({ message: "Unauthorized" }, 401);
  assert.equal(await testPapertrailToken("wrong"), false);
  await assert.rejects(searchLogs("token", { from: "yesterday" }), /ISO times/);
});
