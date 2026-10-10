import assert from "node:assert/strict";
import { test } from "node:test";
import { contextText, freshContext, updateContext } from "./codebaseContext.js";

test("a later role replaces a fact by key and changed sources invalidate it", async () => {
  const files = new Map([["src/app.ts", "v1"]]);
  const fingerprint = async (path: string) => files.get(path) ?? null;
  const first = await updateContext({}, [
    { key: "App.Flow", fact: "The app reads local state", sources: ["src/app.ts"] },
  ], fingerprint);
  assert.match(contextText(first), /app\.flow: The app reads local state/);

  const replaced = await updateContext(first, [
    { key: "app.flow", fact: "The app reads a service", sources: ["src/app.ts"] },
  ], fingerprint);
  assert.equal(Object.keys(replaced).length, 1);
  assert.equal(replaced["app.flow"]?.fact, "The app reads a service");

  files.set("src/app.ts", "v2");
  assert.deepEqual(await freshContext(replaced, fingerprint), {});
  assert.deepEqual(await updateContext(replaced, [], fingerprint), {});
});

test("facts without readable workspace sources are ignored", async () => {
  const context = await updateContext({}, [
    { key: "missing", fact: "An unsupported claim", sources: ["missing.file"] },
  ], async () => null);
  assert.deepEqual(context, {});
});

test("topic keys cannot change the context object's prototype", async () => {
  const fingerprint = async () => "v1";
  const context = await updateContext({}, [
    { key: "__proto__", fact: "A file fact", sources: ["src/app.ts"] },
  ], fingerprint);
  const fresh = await freshContext(context, fingerprint);
  assert.equal(Object.getPrototypeOf(fresh), Object.prototype);
  assert.equal(Object.hasOwn(fresh, "__proto__"), true);
});
