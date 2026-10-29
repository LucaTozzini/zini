// Searching the app's logs in Papertrail, which now runs on SolarWinds Observability: its
// logs API, with a SolarWinds API token. Only log searches are ever made. The API is the
// na-01 region's, where Papertrail accounts (e.g. Heroku's add-on) live.

const API = "https://api.na-01.cloud.solarwinds.com";
export const MAX_EVENTS = 200;
// Longer lines are cut, so one huge stack trace or payload can't flood the result.
const MAX_MESSAGE_LENGTH = 1000;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
// Empty pages followed in one search before giving back its nextPage.
const MAX_PAGES = 10;

async function solarWinds(token: string, url: URL) {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
}

const logsUrl = (params: Record<string, string | undefined>) => {
  const url = new URL("/v1/logs", API);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url;
};

// true if SolarWinds accepts the token, false if it rejects it.
export async function testPapertrailToken(token: string) {
  const response = await solarWinds(token, logsUrl({ pageSize: "1" }));
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) throw new Error(`Couldn't reach Papertrail: ${response.status} ${await response.text()}`);
  return true;
}

type LogEvent = { time: string; hostname: string; program: string | null; severity: string; message: string };
type LogsResponse = { logs?: LogEvent[]; pageInfo?: { nextPage?: string | null } };

// The newest page of log lines matching query (every line if empty), newest first, up to
// MAX_EVENTS: from and to are ISO times, by default the last hour. nextPage is the next,
// older page's address, to pass back as page; it carries the search, so the rest is
// ignored with it. No lines with a nextPage means none were found yet, not none at all.
export async function searchLogs(
  token: string,
  { query, from, to, page }: { query?: string; from?: string; to?: string; page?: string },
) {
  let url: URL;
  if (page) {
    url = new URL(page, API);
    // Only ever the API's own next pages, so a page can't send the token elsewhere.
    if (url.origin !== API || url.pathname !== "/v1/logs") throw new Error("page must be a previous search's nextPage.");
  } else {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - DEFAULT_WINDOW_MS);
    if (Number.isNaN(end.getTime()) || Number.isNaN(start.getTime()))
      throw new Error("from and to must be ISO times, e.g. 2026-10-29T14:00:00Z.");
    url = logsUrl({
      filter: query,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      direction: "backward",
      pageSize: String(MAX_EVENTS),
    });
  }

  // SolarWinds searches a slice of time per page, so a page can be empty with matches
  // further back: empty pages are followed, up to MAX_PAGES, until one has lines.
  let logs: LogEvent[] = [];
  let nextPage: string | null | undefined;
  for (let pages = 0; pages < MAX_PAGES && !logs.length; pages++) {
    const response = await solarWinds(token, url);
    if (!response.ok) throw new Error(`Papertrail search failed: ${response.status} ${await response.text()}`);
    const data = (await response.json()) as LogsResponse;
    logs = data.logs ?? [];
    nextPage = data.pageInfo?.nextPage;
    if (!nextPage) break;
    url = new URL(nextPage, API);
  }
  return {
    // A page's lines come oldest first.
    events: logs
      .toSorted((a, b) => b.time.localeCompare(a.time))
      .map((event) => ({
        time: event.time,
        system: event.hostname,
        program: event.program,
        severity: event.severity,
        message: event.message.length > MAX_MESSAGE_LENGTH ? `${event.message.slice(0, MAX_MESSAGE_LENGTH)}…` : event.message,
      })),
    ...(nextPage && { nextPage }),
  };
}
