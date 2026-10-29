import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

test(
  "readOnlyQuery reads, caps rows, and refuses writes even as a user that could write",
  { skip: process.env.ZINI_DOCKER_TESTS !== "1", timeout: 180000 },
  async () => {
    const { docker } = await import("../workspaces/docker.js");
    const { databaseSchema, describeDatabase, MAX_ROWS, readOnlyQuery, testPostgresUrl } = await import("./postgres.js");
    const name = `zini-postgres-test-${randomUUID()}`;
    await docker([
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "-e",
      "POSTGRES_PASSWORD=secret",
      "-p",
      "127.0.0.1::5432",
      "postgres:17-alpine",
    ]);
    try {
      const port = (await docker(["port", name, "5432"])).trim().split(":").pop();
      // The superuser, which could write: zini's own guard has to stop the writes.
      const url = `postgres://postgres:secret@127.0.0.1:${port}/postgres`;
      for (let i = 0; ; i++) {
        try {
          if (await testPostgresUrl(url)) break;
        } catch (error) {
          if (i >= 60) throw error;
        }
        await sleep(500);
      }

      const admin = new pg.Client({ connectionString: url });
      await admin.connect();
      await admin.query("CREATE TABLE items (id int PRIMARY KEY, label text)");
      await admin.query(`INSERT INTO items SELECT n, 'item ' || n FROM generate_series(1, ${MAX_ROWS + 50}) n`);
      const count = async () => (await admin.query("SELECT count(*)::int AS n FROM items")).rows[0].n;

      const all = await readOnlyQuery(url, "SELECT id, label FROM items ORDER BY id");
      assert.deepEqual(all.columns, ["id", "label"]);
      assert.equal(all.rows.length, MAX_ROWS);
      assert.deepEqual(all.rows[0], [1, "item 1"]);
      assert.equal(all.truncated, true);
      assert.equal((await readOnlyQuery(url, "SELECT count(*) FROM items")).truncated, false);

      // Postgres's own refusals: a write in a read-only transaction, a second statement, a
      // switch to read-write, and a commit inside a block.
      const REFUSED = /read-only transaction|multiple commands|read-write mode|invalid transaction termination/;
      const refused = [
        "INSERT INTO items VALUES (0, 'new')",
        "DELETE FROM items",
        "DROP TABLE items",
        "SELECT 1; DELETE FROM items",
        "SET TRANSACTION READ WRITE",
        "DO $$ BEGIN DELETE FROM items; END $$",
        "DO $$ BEGIN COMMIT; DELETE FROM items; END $$",
      ];
      for (const sql of refused) await assert.rejects(readOnlyQuery(url, sql), REFUSED, sql);
      // A lone COMMIT ends the transaction, but nothing comes after it in the call.
      await readOnlyQuery(url, "COMMIT");
      assert.equal(await count(), MAX_ROWS + 50);

      assert.deepEqual(await describeDatabase(url), [{ table: "public.items", columns: ["id integer", "label text null"] }]);

      // A second schema with a foreign key to items, and a table the user can't read,
      // which is left out of the drawing along with its relation.
      await admin.query("CREATE SCHEMA app");
      await admin.query("CREATE TABLE app.tags (item_id int REFERENCES items(id), tag text, PRIMARY KEY (item_id, tag))");
      await admin.query("CREATE ROLE reader LOGIN PASSWORD 'reader'");
      await admin.query("GRANT USAGE ON SCHEMA app TO reader");
      await admin.query("GRANT SELECT ON items TO reader");
      assert.deepEqual(await databaseSchema(url), {
        tables: [
          {
            id: "app.tags",
            schema: "app",
            name: "tags",
            columns: [
              { name: "item_id", type: "integer", nullable: false, primaryKey: true },
              { name: "tag", type: "text", nullable: false, primaryKey: true },
            ],
          },
          {
            id: "public.items",
            schema: "public",
            name: "items",
            columns: [
              { name: "id", type: "integer", nullable: false, primaryKey: true },
              { name: "label", type: "text", nullable: true, primaryKey: false },
            ],
          },
        ],
        relations: [{ from: "app.tags", fromColumns: ["item_id"], to: "public.items", toColumns: ["id"] }],
      });
      const asReader = await databaseSchema(url.replace("postgres:secret", "reader:reader"));
      assert.deepEqual(
        asReader.tables.map((t) => t.id),
        ["public.items"],
      );
      assert.deepEqual(asReader.relations, []);
      assert.deepEqual(
        asReader.tables[0]?.columns.map((c) => c.primaryKey),
        [true, false],
      );
      assert.equal(await testPostgresUrl(url.replace("secret", "wrong")), false);
      await admin.end();
    } finally {
      await docker(["stop", name]).catch(() => {});
    }
  },
);
