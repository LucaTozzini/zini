import pg from "pg";
import Cursor from "pg-cursor";
import type { DatabaseSchema } from "shared";

// Read-only access to a Postgres database (the user's production database), on demand:
// each call opens its own connection and closes it, so zini never holds one open.

export const MAX_ROWS = 200;
// Longer values are cut, so one big text or JSON column can't flood the result.
const MAX_VALUE_LENGTH = 500;
const STATEMENT_TIMEOUT = "15s";

async function withClient<T>(url: string, use: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  // An error on the idle connection (e.g. the server closing it) would otherwise crash
  // the process; the call's own error is what's reported.
  client.on("error", () => {});
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end().catch(() => {});
  }
}

// "user@host/database" from a connection string, to show which database is connected.
export function postgresHint(url: string) {
  const match = url.match(/^postgres(?:ql)?:\/\/([^:@/]*)(?::[^@/]*)?@([^:/?]+)(?::\d+)?\/([^?]*)/);
  return match ? `${decodeURIComponent(match[1] ?? "")}@${match[2]}/${decodeURIComponent(match[3] ?? "")}` : "a database";
}

// true if Postgres accepts the connection string, false if it rejects the password
// (28P01). Other failures throw with what went wrong: 28000 is also how a server that
// requires SSL refuses a connection without it, and a self-signed certificate (Heroku's)
// fails sslmode=require.
export async function testPostgresUrl(url: string) {
  try {
    await withClient(url, (client) => client.query("SELECT 1"));
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "28P01") return false;
    const message = error instanceof Error ? error.message : String(error);
    const hint = /self[- ]signed certificate/i.test(message)
      ? " The server's certificate is self-signed, as Heroku's are: end the URL with ?sslmode=no-verify instead of sslmode=require."
      : /SSL off|no encryption/i.test(message)
        ? " The server requires SSL: end the URL with ?sslmode=no-verify (or sslmode=verify-full if its certificate is trusted)."
        : "";
    throw new Error(`Couldn't connect to the database: ${message}.${hint}`);
  }
}

// Runs use inside a read-only transaction that's always rolled back. The SELECT 1 takes
// the transaction's snapshot, after which Postgres won't let it become read-write.
function readOnly<T>(url: string, use: (client: pg.Client) => Promise<T>) {
  return withClient(url, async (client) => {
    await client.query("BEGIN READ ONLY");
    try {
      await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
      await client.query("SELECT 1");
      return await use(client);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
    }
  });
}

const cell = (value: unknown) => {
  if (Buffer.isBuffer(value)) return `<${value.length} bytes>`;
  const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : value;
  return typeof text === "string" && text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
};

// One SQL statement's result, read-only: its columns and up to MAX_ROWS rows, each an
// array of values. The statement goes through a cursor, which uses Postgres's extended
// protocol: it refuses more than one statement, and only the rows read are fetched.
export function readOnlyQuery(url: string, sql: string) {
  return readOnly(url, async (client) => {
    const cursor = client.query(new Cursor(sql, [], { rowMode: "array" }));
    try {
      const { rows, fields } = await new Promise<{ rows: unknown[][]; fields: { name: string }[] }>((resolve, reject) =>
        cursor.read(MAX_ROWS + 1, (error, rows, result) =>
          error ? reject(error) : resolve({ rows, fields: result.fields ?? [] }),
        ),
      );
      return {
        columns: fields.map((field) => field.name),
        rows: rows.slice(0, MAX_ROWS).map((row) => row.map(cell)),
        truncated: rows.length > MAX_ROWS,
      };
    } finally {
      await cursor.close().catch(() => {});
    }
  });
}

// The database's tables and views outside Postgres's own schemas, each with its columns
// as "name type", and whether it can be null.
export function describeDatabase(url: string) {
  return readOnly(url, async (client) => {
    const { rows } = await client.query<{ table: string; columns: string[] }>(`
      SELECT table_schema || '.' || table_name AS table,
        array_agg(column_name || ' ' || data_type || CASE WHEN is_nullable = 'YES' THEN ' null' ELSE '' END
          ORDER BY ordinal_position) AS columns
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%'
      GROUP BY table_schema, table_name
      ORDER BY table_schema, table_name`);
    return rows;
  });
}

// The database's tables (and views) with their columns, primary keys and foreign keys,
// for drawing it: only tables the connected user can read, outside Postgres's own
// schemas. Keys come from pg_catalog, since information_schema hides them from a user
// that can only read.
export function databaseSchema(url: string): Promise<DatabaseSchema> {
  return readOnly(url, async (client) => {
    const columns = await client.query<{
      table: string;
      schema: string;
      name: string;
      column: string;
      type: string;
      nullable: boolean;
    }>(`
      SELECT table_schema || '.' || table_name AS table, table_schema AS schema, table_name AS name,
        column_name AS column, data_type AS type, is_nullable = 'YES' AS nullable
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%'
      ORDER BY table_schema, table_name, ordinal_position`);
    const keys = await client.query<{
      kind: "p" | "f";
      table: string;
      columns: string[];
      references: string | null;
      referenced: string[] | null;
    }>(`
      SELECT c.contype AS kind, fn.nspname || '.' || fc.relname AS table,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n, i)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.i) AS columns,
        tn.nspname || '.' || tc.relname AS references,
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n, i)
          JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.i) AS referenced
      FROM pg_constraint c
      JOIN pg_class fc ON fc.oid = c.conrelid JOIN pg_namespace fn ON fn.oid = fc.relnamespace
      LEFT JOIN pg_class tc ON tc.oid = c.confrelid LEFT JOIN pg_namespace tn ON tn.oid = tc.relnamespace
      WHERE c.contype IN ('p', 'f') AND fn.nspname NOT IN ('pg_catalog', 'information_schema')
        AND has_table_privilege(c.conrelid, 'SELECT')`);

    const primaryKeys = new Map(keys.rows.filter((k) => k.kind === "p").map((k) => [k.table, new Set(k.columns)]));
    const tables = new Map<string, DatabaseSchema["tables"][number]>();
    for (const row of columns.rows) {
      let table = tables.get(row.table);
      if (!table) tables.set(row.table, (table = { id: row.table, schema: row.schema, name: row.name, columns: [] }));
      table.columns.push({
        name: row.column,
        type: row.type,
        nullable: row.nullable,
        primaryKey: Boolean(primaryKeys.get(row.table)?.has(row.column)),
      });
    }
    // Only between tables the user can read, so every relation has both ends drawn.
    const relations = keys.rows
      .filter((k) => k.kind === "f" && k.references && tables.has(k.table) && tables.has(k.references))
      .map((k) => ({ from: k.table, fromColumns: k.columns, to: k.references!, toColumns: k.referenced ?? [] }));
    return { tables: [...tables.values()], relations };
  });
}
