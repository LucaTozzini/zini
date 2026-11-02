import { auth, searchconsole } from "@googleapis/searchconsole";
import { isRejectedKey, parseServiceAccountKey } from "./googleServiceAccount.js";

// Read-only access to one Google Search Console property as a service account: it sees
// the properties it's added to as a user, and each project reads one of them (its site:
// sc-domain:example.com for a domain property, or a URL prefix like https://example.com/).

export const DIMENSIONS = ["query", "page", "country", "device", "searchAppearance", "date"] as const;
export const OPERATORS = ["equals", "notEquals", "contains", "notContains", "includingRegex", "excludingRegex"] as const;
export const SEARCH_TYPES = ["web", "image", "video", "news", "discover", "googleNews"] as const;
export const MAX_ROWS = 1000;
// The days a query covers when it gives no start date, up to its end date.
const DEFAULT_DAYS = 28;

function client(key: string) {
  return searchconsole({
    version: "v1",
    auth: new auth.GoogleAuth({
      credentials: parseServiceAccountKey(key),
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    }),
  });
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// true if Google accepts the key and it can read site, false if it rejects the key (a
// deleted or disabled key). Other failures throw with what to do, e.g. add the service
// account to the property, or enable the API in its project.
export async function testGoogleSearchConsole(key: string, site: string) {
  // Outside the try, so a key that isn't one says so as it is.
  const { client_email } = parseServiceAccountKey(key);
  const api = client(key);
  const notAUser = new Error(
    `${client_email} can't read ${site}. In Search Console, open the property's Settings → Users and permissions and add it, ` +
      "or check the property is written as it is there: sc-domain:example.com for a domain property, or the full URL prefix.",
  );
  let permissionLevel: string | null | undefined;
  try {
    ({ permissionLevel } = (await api.sites.get({ siteUrl: site })).data);
  } catch (error) {
    const message = errorText(error);
    if (isRejectedKey(message)) return false;
    if (/permission|not found/i.test(message) && !/has not been used|is disabled/i.test(message)) throw notAUser;
    throw new Error(`Couldn't reach Google Search Console: ${message}`);
  }
  if (permissionLevel === "siteUnverifiedUser") throw notAUser;
  return true;
}

export type SearchConsoleQuery = {
  startDate?: string;
  endDate?: string;
  dimensions?: (typeof DIMENSIONS)[number][];
  filters?: { dimension: (typeof DIMENSIONS)[number]; operator: (typeof OPERATORS)[number]; expression: string }[];
  type?: (typeof SEARCH_TYPES)[number];
  rowLimit?: number;
  startRow?: number;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

// The site's clicks, impressions, CTR and average position from startDate to endDate (the
// last 28 days by default), one row per combination of dimensions' values, or one row in
// all without dimensions. Rows come by clicks, most first (by date when grouped by date);
// truncated when there may be more.
export async function queryGoogleSearchConsole(key: string, site: string, query: SearchConsoleQuery) {
  const endDate = query.endDate ?? isoDate(new Date());
  const startDate = query.startDate ?? isoDate(new Date(Date.parse(endDate) - (DEFAULT_DAYS - 1) * 86_400_000));
  const dimensions = query.dimensions ?? [];
  const rowLimit = Math.min(query.rowLimit ?? 100, MAX_ROWS);
  const { data } = await client(key).searchanalytics.query({
    siteUrl: site,
    requestBody: {
      startDate,
      endDate,
      dimensions,
      dimensionFilterGroups: query.filters?.length ? [{ groupType: "and", filters: query.filters }] : undefined,
      type: query.type,
      rowLimit,
      startRow: query.startRow,
    },
  });
  const rows = (data.rows ?? []).map((row) => ({
    ...Object.fromEntries(dimensions.map((dimension, i) => [dimension, row.keys?.[i]])),
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: Math.round((row.ctr ?? 0) * 10000) / 10000,
    position: Math.round((row.position ?? 0) * 10) / 10,
  }));
  return { site, startDate, endDate, rows, truncated: rows.length === rowLimit };
}
