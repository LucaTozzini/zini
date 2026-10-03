import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { TodoStore } from "./store";

let base = "";
let close = () => {};

beforeAll(() => {
  const store = new TodoStore(join(mkdtempSync(join(tmpdir(), "todos-")), "todos.json"));
  const server = createApp(store).listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}/api/todos`;
  close = () => server.close();
});
afterAll(() => close());

const post = (body: unknown) =>
  fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("the to-do API", () => {
  it("creates a to-do", async () => {
    const res = await post({ title: "Plan the week" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ title: "Plan the week", done: false });
  });

  it("rejects a to-do without a title", async () => {
    expect((await post({ title: "  " })).status).toBe(400);
  });

  it("returns 404 for a to-do that doesn't exist", async () => {
    expect((await fetch(`${base}/missing`, { method: "DELETE" })).status).toBe(404);
  });
});
