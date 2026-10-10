import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { BatchConsole, followConsole, readConsoleTail } from "./batchConsole.js";

test("batch logs keep full output while the live and restored tails stay bounded", () => {
  const folder = mkdtempSync(join(tmpdir(), "zini-console-"));
  try {
    const file = join(folder, "batch", "console.log");
    const log = new BatchConsole(file);
    for (let n = 0; n < 600; n++) log.append(`line ${n}: ${"x".repeat(600)}`);
    log.append("hidden check passed\nfinished ✓");
    const full = readFileSync(file, "utf8");
    assert.ok(full.startsWith("line 0:"));
    assert.ok(full.endsWith("hidden check passed\nfinished ✓\n"));
    assert.equal(log.tail.length, 500);
    const restored = new BatchConsole(file);
    assert.deepEqual(restored.tail, readConsoleTail(file));
    assert.equal(restored.tail.at(-1), "finished ✓");
    restored.append("cleanup complete");
    assert.ok(readFileSync(file, "utf8").startsWith(full));
    assert.equal(restored.tail.at(-1), "cleanup complete");
    writeFileSync(file, "");
    assert.deepEqual(readConsoleTail(file), []);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("stdout and stderr retain separate partial lines and decode split UTF-8", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const lines: string[] = [];
  followConsole(stdout, line => lines.push(line));
  followConsole(stderr, line => lines.push(line));
  const done = Promise.all([finished(stdout), finished(stderr)]);
  const unicode = Buffer.from("✓");
  stdout.write(Buffer.concat([Buffer.from("out "), unicode.subarray(0, 1)]));
  stderr.write("err\r\nlast error");
  stdout.write(Buffer.concat([unicode.subarray(1), Buffer.from("\r\nlast output")]));
  stdout.end();
  stderr.end();
  await done;
  assert.deepEqual(lines, ["err", "out ✓", "last output", "last error"]);
});
